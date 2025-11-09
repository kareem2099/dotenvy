"""
Database models and connection management for LLM Service
==========================================================

Handles PostgreSQL integration for model persistence and analytics.
"""

import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Float, JSON, Boolean, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool
from sqlalchemy.exc import SQLAlchemyError

Base = declarative_base()

class ModelTrainingSample(Base):
    """Store training samples for model improvement."""
    __tablename__ = "training_samples"

    id = Column(Integer, primary_key=True, index=True)
    secret_value_hash = Column(String(64), index=True)  # SHA-256 hash for privacy
    context_hash = Column(String(64), index=True)      # SHA-256 hash for privacy
    features = Column(JSON)                            # Feature vector
    label = Column(String(20), index=True)             # high/medium/low/false_positive
    user_action = Column(String(50))                   # confirmed_secret/ignored_warning/etc
    confidence_score = Column(Float)                   # Model confidence
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    model_version = Column(String(50), index=True)     # Which model version this was for

class AnalysisRequest(Base):
    """Store analysis request metrics for analytics."""
    __tablename__ = "analysis_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(String(32), unique=True, index=True)
    client_ip = Column(String(45))                     # IPv4/IPv6 support
    user_agent = Column(Text)
    secret_type = Column(String(50))                   # API Key, Token, etc.
    risk_level = Column(String(20))                    # critical/high/medium/low
    confidence = Column(Float)
    processing_time_ms = Column(Integer)
    cache_hit = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    api_key_hash = Column(String(64), index=True)      # Hashed API key for usage tracking

class ModelVersion(Base):
    """Track model versions and performance metrics."""
    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, index=True)
    version_name = Column(String(100), unique=True, index=True)
    description = Column(Text)
    accuracy = Column(Float)
    total_predictions = Column(Integer, default=0)
    correct_predictions = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=False)
    parameters = Column(JSON)                          # Model hyperparameters

class SystemMetrics(Base):
    """Store system performance metrics."""
    __tablename__ = "system_metrics"

    id = Column(Integer, primary_key=True, index=True)
    metric_type = Column(String(50), index=True)      # cpu_usage, memory_usage, etc.
    value = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    service_instance = Column(String(100))            # For multi-instance deployments

class DatabaseManager:
    """Manages database connections and operations."""

    def __init__(self):
        self.database_url = os.getenv('DATABASE_URL', 'sqlite:///./llm_service.db')
        self.engine = None
        self.SessionLocal = None
        self._initialize_database()

    def _initialize_database(self):
        """Initialize database connection and create tables."""
        try:
            # Configure connection pool for production
            connect_args = {}
            if self.database_url.startswith('sqlite'):
                connect_args = {"check_same_thread": False}
            else:
                # Production PostgreSQL settings
                connect_args = {
                    "pool_pre_ping": True,
                    "pool_recycle": 300,
                }

            self.engine = create_engine(
                self.database_url,
                connect_args=connect_args,
                poolclass=QueuePool if not self.database_url.startswith('sqlite') else None,
                pool_pre_ping=True,
                echo=False  # Set to True for debugging
            )

            self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

            # Create tables
            Base.metadata.create_all(bind=self.engine)
            print("✅ Database initialized successfully")

        except SQLAlchemyError as e:
            print(f"❌ Database initialization failed: {e}")
            # Fallback to in-memory SQLite for development
            if not self.database_url.startswith('sqlite'):
                print("🔄 Falling back to SQLite...")
                self.database_url = 'sqlite:///./llm_service.db'
                self._initialize_database()

    def get_session(self) -> Session:
        """Get a database session."""
        return self.SessionLocal()

    def store_training_sample(self, secret_hash: str, context_hash: str, features: List[float],
                            label: str, user_action: str, confidence: float, model_version: str = "default"):
        """Store a training sample in the database."""
        try:
            with self.get_session() as session:
                sample = ModelTrainingSample(
                    secret_value_hash=secret_hash,
                    context_hash=context_hash,
                    features=features,
                    label=label,
                    user_action=user_action,
                    confidence_score=confidence,
                    model_version=model_version
                )
                session.add(sample)
                session.commit()
                return sample.id
        except SQLAlchemyError as e:
            print(f"❌ Failed to store training sample: {e}")
            return None

    def store_analysis_request(self, request_id: str, client_ip: str, user_agent: str,
                             secret_type: str, risk_level: str, confidence: float,
                             processing_time_ms: int, cache_hit: bool, api_key_hash: str):
        """Store analysis request metrics."""
        try:
            with self.get_session() as session:
                request = AnalysisRequest(
                    request_id=request_id,
                    client_ip=client_ip,
                    user_agent=user_agent,
                    secret_type=secret_type,
                    risk_level=risk_level,
                    confidence=confidence,
                    processing_time_ms=processing_time_ms,
                    cache_hit=cache_hit,
                    api_key_hash=api_key_hash
                )
                session.add(request)
                session.commit()
                return request.id
        except SQLAlchemyError as e:
            print(f"❌ Failed to store analysis request: {e}")
            return None

    def get_training_samples(self, limit: int = 1000, model_version: str = None) -> List[Dict[str, Any]]:
        """Retrieve training samples for model training."""
        try:
            with self.get_session() as session:
                query = session.query(ModelTrainingSample)
                if model_version:
                    query = query.filter(ModelTrainingSample.model_version == model_version)
                samples = query.order_by(ModelTrainingSample.created_at.desc()).limit(limit).all()

                return [{
                    'id': s.id,
                    'secret_hash': s.secret_hash,
                    'context_hash': s.context_hash,
                    'features': s.features,
                    'label': s.label,
                    'user_action': s.user_action,
                    'confidence': s.confidence_score,
                    'created_at': s.created_at.isoformat(),
                    'model_version': s.model_version
                } for s in samples]
        except SQLAlchemyError as e:
            print(f"❌ Failed to retrieve training samples: {e}")
            return []

    def get_analytics_summary(self, days: int = 7) -> Dict[str, Any]:
        """Get analytics summary for the specified number of days."""
        try:
            with self.get_session() as session:
                # Calculate date threshold
                from datetime import timedelta
                threshold = datetime.utcnow() - timedelta(days=days)

                # Query metrics
                total_requests = session.query(AnalysisRequest).filter(
                    AnalysisRequest.created_at >= threshold
                ).count()

                cache_hits = session.query(AnalysisRequest).filter(
                    AnalysisRequest.created_at >= threshold,
                    AnalysisRequest.cache_hit == True
                ).count()

                avg_processing_time = session.query(AnalysisRequest).filter(
                    AnalysisRequest.created_at >= threshold
                ).with_entities(AnalysisRequest.processing_time_ms).all()

                processing_times = [t[0] for t in avg_processing_time if t[0] is not None]
                avg_time = sum(processing_times) / len(processing_times) if processing_times else 0

                # Risk level distribution
                risk_counts = {}
                risk_results = session.query(AnalysisRequest.risk_level, AnalysisRequest.id).filter(
                    AnalysisRequest.created_at >= threshold
                ).all()

                for risk_level, _ in risk_results:
                    risk_counts[risk_level] = risk_counts.get(risk_level, 0) + 1

                return {
                    'total_requests': total_requests,
                    'cache_hit_rate': cache_hits / total_requests if total_requests > 0 else 0,
                    'average_processing_time_ms': avg_time,
                    'risk_distribution': risk_counts,
                    'period_days': days
                }
        except SQLAlchemyError as e:
            print(f"❌ Failed to get analytics summary: {e}")
            return {}

    def cleanup_old_data(self, days_to_keep: int = 90):
        """Clean up old data to manage database size."""
        try:
            with self.get_session() as session:
                threshold = datetime.utcnow() - timedelta(days=days_to_keep)

                # Delete old training samples (keep recent ones)
                deleted_samples = session.query(ModelTrainingSample).filter(
                    ModelTrainingSample.created_at < threshold
                ).delete()

                # Delete old analysis requests
                deleted_requests = session.query(AnalysisRequest).filter(
                    AnalysisRequest.created_at < threshold
                ).delete()

                # Delete old system metrics
                deleted_metrics = session.query(SystemMetrics).filter(
                    SystemMetrics.timestamp < threshold
                ).delete()

                session.commit()

                print(f"🧹 Cleaned up {deleted_samples} training samples, {deleted_requests} requests, {deleted_metrics} metrics")
                return True
        except SQLAlchemyError as e:
            print(f"❌ Failed to cleanup old data: {e}")
            return False

    def optimize_database(self):
        """Optimize database performance with indexes and maintenance."""
        try:
            with self.engine.connect() as conn:
                # Create indexes for better query performance
                indexes = [
                    "CREATE INDEX IF NOT EXISTS idx_analysis_timestamp ON analysis_requests(created_at)",
                    "CREATE INDEX IF NOT EXISTS idx_analysis_client_ip ON analysis_requests(client_ip)",
                    "CREATE INDEX IF NOT EXISTS idx_analysis_risk_level ON analysis_requests(risk_level)",
                    "CREATE INDEX IF NOT EXISTS idx_analysis_secret_type ON analysis_requests(secret_type)",
                    "CREATE INDEX IF NOT EXISTS idx_analysis_cache_hit ON analysis_requests(cache_hit)",
                    "CREATE INDEX IF NOT EXISTS idx_training_secret_hash ON training_samples(secret_value_hash)",
                    "CREATE INDEX IF NOT EXISTS idx_training_model_version ON training_samples(model_version)",
                    "CREATE INDEX IF NOT EXISTS idx_training_timestamp ON training_samples(created_at)",
                    "CREATE INDEX IF NOT EXISTS idx_training_label ON training_samples(label)",
                ]

                for index_sql in indexes:
                    try:
                        conn.execute(text(index_sql))
                        conn.commit()
                    except Exception as idx_error:
                        print(f"Index creation failed: {idx_error}")

                # Analyze tables for query optimization (PostgreSQL)
                if not self.database_url.startswith('sqlite'):
                    try:
                        conn.execute(text("ANALYZE analysis_requests"))
                        conn.execute(text("ANALYZE training_samples"))
                        conn.commit()
                        print("Database analysis completed")
                    except Exception as analyze_error:
                        print(f"Table analysis failed: {analyze_error}")

                # Vacuum database (SQLite specific optimization)
                if self.database_url.startswith('sqlite'):
                    try:
                        conn.execute(text("VACUUM"))
                        conn.commit()
                        print("Database vacuum completed")
                    except Exception as vacuum_error:
                        print(f"Vacuum failed: {vacuum_error}")

        except Exception as e:
            print(f"Database optimization failed: {e}")

    def get_performance_stats(self) -> Dict[str, Any]:
        """Get database performance statistics."""
        try:
            stats = {
                'database_type': 'postgresql' if not self.database_url.startswith('sqlite') else 'sqlite',
                'connection_pool': {
                    'pool_size': getattr(self.engine.pool, 'size', 'unknown'),
                    'checked_out': getattr(self.engine.pool, 'checkedout', lambda: 'unknown')() if hasattr(self.engine.pool, 'checkedout') else 'unknown',
                },
                'last_optimized': datetime.utcnow().isoformat()
            }

            # Get table statistics
            with self.get_session() as session:
                # Analysis requests count
                analysis_count = session.query(AnalysisRequest).count()
                training_count = session.query(ModelTrainingSample).count()

                stats['tables'] = {
                    'analysis_requests': {'row_count': analysis_count},
                    'training_samples': {'row_count': training_count}
                }

            return stats

        except Exception as e:
            print(f"Failed to get performance stats: {e}")
            return {'error': str(e)}

# Global database manager instance
db_manager = DatabaseManager()
