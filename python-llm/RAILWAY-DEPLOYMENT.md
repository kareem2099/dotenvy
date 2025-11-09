# 🚂 Railway Deployment Guide

Deploy your LLM Secret Detection Service to Railway in 5 minutes!

## 📋 Prerequisites

- Railway account ([railway.app](https://railway.app))
- GitHub repository with your code
- API key for authentication

## 🚀 Quick Deployment (5 Minutes)

### Step 1: Connect Repository
1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your repository
4. Railway auto-detects your `railway.json` and Dockerfile

### Step 2: Configure Databases
Railway automatically creates:
- ✅ **PostgreSQL Database** (managed)
- ✅ **Redis Cache** (managed)

### Step 3: Set Environment Variables
In Railway dashboard, go to **Variables** tab and add:

```bash
API_KEY=your-secure-api-key-here
JWT_SECRET=your-jwt-secret-here
ENVIRONMENT=production
LOG_LEVEL=INFO
RATE_LIMIT_REQUESTS_PER_MINUTE=100
```

### Step 4: Deploy
Click **"Deploy"** - Railway handles everything automatically!

## 🔧 Manual Configuration (Optional)

If you need custom configuration:

### Database URLs
Railway provides these automatically:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string

### Custom Domain
1. Go to **Settings** → **Domains**
2. Add your custom domain
3. Railway provides SSL certificates automatically

## 📊 Monitoring & Logs

### View Logs
```bash
railway logs
```

### Health Checks
- **Health Endpoint**: `GET /health`
- **Detailed Health**: `GET /health/detailed`
- **Performance Report**: `GET /performance/report`

### Metrics Dashboard
Railway provides built-in monitoring for:
- CPU usage
- Memory usage
- Network traffic
- Error rates

## 🔄 Updates & Rollbacks

### Automatic Deployments
Railway deploys automatically when you push to main branch.

### Manual Rollback
1. Go to **Deployments** tab
2. Click on previous deployment
3. Click **"Rollback"**

## 💰 Pricing for 70-100 Users

```
Railway Hobby Plan: $5/month
├── Web Service: Included
├── PostgreSQL: Included (512MB)
├── Redis: Included
└── Global CDN: Included
```

**Upgrade to Pro Plan ($10/month) for:**
- More resources
- Team collaboration
- Advanced monitoring

## 🛠️ Troubleshooting

### Common Issues

**Build Fails:**
- Check your Dockerfile is in the root directory
- Ensure all dependencies are in `requirements.txt`

**Database Connection:**
- Railway creates databases automatically
- Check environment variables are set correctly

**Health Check Fails:**
- Service needs time to start (up to 5 minutes)
- Check logs for startup errors

### Support
- Railway Docs: [docs.railway.app](https://docs.railway.app)
- Community: [Discord](https://discord.gg/railway)

## 🎯 Performance Optimization

For 70-100 users, Railway automatically:
- ✅ Scales instances based on load
- ✅ Provides global CDN
- ✅ Manages database connections
- ✅ Handles SSL termination

## 🔒 Security Features

Railway provides:
- ✅ Automatic SSL certificates
- ✅ Private networking
- ✅ Environment variable encryption
- ✅ Database backups

## 📞 Need Help?

If you encounter issues:
1. Check Railway logs in dashboard
2. Verify environment variables
3. Ensure Dockerfile is correct
4. Contact Railway support

---

**🎉 Your LLM service will be live in production within 5 minutes!**
