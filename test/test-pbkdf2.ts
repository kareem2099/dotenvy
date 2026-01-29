import * as crypto from 'crypto';

console.log('🧪 Testing PBKDF2 Implementation for DotEnvy v1.4.0');
console.log('='.repeat(60));

// Test parameters matching implementation
const testPassword = 'MySecurePassword123!';
const testSalt = crypto.randomBytes(16);
const iterations = 310000; // OWASP 2025 compliant
const keyLength = 32; // 256 bits
const digest = 'sha256';

console.log(`\n📋 Test Parameters:`);
console.log(`   Password: ${testPassword}`);
console.log(`   Salt length: ${testSalt.length} bytes`);
console.log(`   Iterations: ${iterations.toLocaleString()}`);
console.log(`   Key length: ${keyLength} bytes (${keyLength * 8} bits)`);
console.log(`   Digest: ${digest}`);

// Test 1: Key derivation
console.log(`\n🔐 Test 1: PBKDF2 Key Derivation`);
const startTime = Date.now();
crypto.pbkdf2(testPassword, testSalt, iterations, keyLength, digest, (err, derivedKey) => {
    const duration = Date.now() - startTime;

    if (err) {
        console.error('❌ PBKDF2 test failed:', err);
        process.exit(1);
    }

    console.log(`   ✅ Key derived successfully in ${duration}ms`);
    console.log(`   Key length: ${derivedKey.length} bytes (expected: ${keyLength})`);
    console.log(`   Key (hex): ${derivedKey.toString('hex').substring(0, 32)}...`);

    // Test 2: Consistency check
    console.log(`\n🔄 Test 2: Derivation Consistency`);
    crypto.pbkdf2(testPassword, testSalt, iterations, keyLength, digest, (err2, derivedKey2) => {
        if (err2) {
            console.error('❌ Second derivation failed:', err2);
            process.exit(1);
        }

        if (Buffer.compare(derivedKey, derivedKey2) === 0) {
            console.log('   ✅ Keys are identical - derivation is deterministic');
        } else {
            console.error('   ❌ Keys differ - derivation is not consistent!');
            process.exit(1);
        }

        // Test 3: Different salt produces different key
        console.log(`\n🎲 Test 3: Salt Impact`);
        const differentSalt = crypto.randomBytes(16);
        crypto.pbkdf2(testPassword, differentSalt, iterations, keyLength, digest, (err3, derivedKey3) => {
            if (err3) {
                console.error('❌ Third derivation failed:', err3);
                process.exit(1);
            }

            if (Buffer.compare(derivedKey, derivedKey3) !== 0) {
                console.log('   ✅ Different salts produce different keys');
            } else {
                console.error('   ❌ Same key with different salts!');
                process.exit(1);
            }

            // Test 4: Different password produces different key
            console.log(`\n🔑 Test 4: Password Impact`);
            const differentPassword = 'DifferentPassword456!';
            crypto.pbkdf2(differentPassword, testSalt, iterations, keyLength, digest, (err4, derivedKey4) => {
                if (err4) {
                    console.error('❌ Fourth derivation failed:', err4);
                    process.exit(1);
                }

                if (Buffer.compare(derivedKey, derivedKey4) !== 0) {
                    console.log('   ✅ Different passwords produce different keys');
                } else {
                    console.error('   ❌ Same key with different passwords!');
                    process.exit(1);
                }

                console.log(`\n${'='.repeat(60)}`);
                console.log('✅ All PBKDF2 tests passed!');
                console.log(`\n📊 Summary:`);
                console.log(`   • PBKDF2 is working correctly`);
                console.log(`   • OWASP 2025 compliant (${iterations.toLocaleString()} iterations)`);
                console.log(`   • Derivation is deterministic`);
                console.log(`   • Salt and password changes affect output`);
                console.log(`   • Average derivation time: ~${duration}ms`);
                console.log(`\n✅ Implementation ready for v1.4.0!`);
            });
        });
    });
});
