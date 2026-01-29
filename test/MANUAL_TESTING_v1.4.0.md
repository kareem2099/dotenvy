# Manual Testing Guide for v1.4.0 Password-Based Backups

## ✅ Automated Tests Status
**All 9 automated integration tests passed (100%)**
- ✅ Basic Encryption/Decryption
- ✅ Wrong Password Rejection  
- ✅ Corrupted Data Handling
- ✅ Large File Encryption (1000+ variables)
- ✅ Special Characters in Passwords
- ✅ Edge Case Data Handling
- ✅ Cross-Device Portability
- ✅ Salt Uniqueness
- ✅ PBKDF2 Performance

---

## 🧪 Manual Testing Scenarios

### Scenario 1: Create Password-Protected Backup ✅

**Steps:**
1. Open VS Code with DotEnvy extension
2. Ensure you have a `.env` file with some content:
   ```
   API_KEY=test123
   DATABASE_URL=postgresql://localhost/mydb
   SECRET_TOKEN=supersecret
   ```
3. Open Command Palette (`Ctrl+Shift+P`)
4. Run: `DotEnvy: Open Environment Panel`
5. Click **"Backup Current Environment"** button
6. Select: **"🔐 Password Protection (Recommended)"**
7. Enter password: `TestBackup2026!`
8. Confirm password: `TestBackup2026!`

**Expected Result:**
- ✅ Success message: "✅ Password-protected backup created!"
- ✅ Message shows filename and portability note
- ✅ Backup file created at `~/.dotenvy-backups/<workspace>/env.backup.<timestamp>.enc`

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 2: Restore Password-Protected Backup ✅

**Steps:**
1. In Environment Panel, click **"Restore from Backup"**
2. Select the backup created in Scenario 1
3. Note the backup is marked as **"🔐 Password protected"**
4. Enter password: `TestBackup2026!`
5. Choose: **"Create new file"** (to avoid overwriting .env)

**Expected Result:**
- ✅ File `.env.restored` created with correct content
- ✅ Content matches original `.env` exactly
- ✅ File opens automatically in editor

**Verification:**
```bash
# Compare files
diff .env .env.restored
# Should show no differences
```

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 3: Wrong Password Error ❌ (Expected Failure)

**Steps:**
1. Click **"Restore from Backup"**
2. Select a password-protected backup
3. Enter **wrong** password: `WrongPassword123!`

**Expected Result:**
- ❌ Error message: "❌ Incorrect password or corrupted backup file."
- ✅ No file created
- ✅ Original .env unchanged

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 4: Legacy Backup (Backward Compatibility) ✅

**Steps:**
1. Create a backup using **"Legacy Encryption"** option
2. Note the filename includes `.legacy.enc`
3. Try to restore this legacy backup
4. Should work without password prompt (uses SecretStorage)

**Expected Result:**
- ✅ Legacy backup detects format correctly
- ✅ Message: "📦 Legacy encrypted backup detected. Using VSCode SecretStorage..."
- ✅ Restoration successful

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 5: Plaintext Backup ✅

**Steps:**
1. Create backup with **"📄 No Encryption"** option
2. Note the filename ends with `.txt`
3. Verify file is readable plaintext
4. Restore the plaintext backup

**Expected Result:**
- ✅ Backup created as plaintext
- ✅ Can open with any text editor
- ✅ Restore works without password
- ⚠️ Warning shown: "⚠️ This backup is not encrypted."

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 6: Cross-Device Simulation 🌐

**Steps:**
1. Create password-protected backup on current device
2. Copy `.enc` file to USB drive
3. On different computer (or fresh VSCode instance):
   - Install DotEnvy extension
   - Copy backup to `~/.dotenvy-backups/<workspace>/`
   - Restore using same password

**Expected Result:**
- ✅ Backup restores successfully on different device
- ✅ No dependency on original VSCode installation
- ✅ Same password works everywhere

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 7: Special Characters in Password 🔐

**Steps:**
1. Create backup with password: `P@ssw0rd!#$%^&*()`
2. Restore with exact same password
3. Try with slightly different password (wrong): `P@ssw0rd!#$%^&*()_` (extra underscore)

**Expected Result:**
- ✅ Special characters work correctly
- ✅ Exact password required
- ❌ Wrong password rejected

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 8: Password Confirmation Mismatch ❌ (Expected Failure)

**Steps:**
1. Start backup creation with password protection
2. Enter password: `FirstPassword123!`
3. Enter different confirmation: `SecondPassword456!`

**Expected Result:**
- ❌ Error: "Passwords do not match. Backup cancelled."
- ✅ No backup created

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 9: Empty Password Validation ❌ (Expected Failure)

**Steps:**
1. Start backup creation with password protection
2. Try to submit empty password (just press Enter)

**Expected Result:**
- ❌ Validation error: "Password cannot be empty"
- ✅ Cannot proceed until valid password entered

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

### Scenario 10: Large Environment File 📊

**Steps:**
1. Create `.env` with 100+ variables
2. Create password-protected backup
3. Verify backup completes in reasonable time (<2 seconds)
4. Restore and verify all variables present

**Expected Result:**
- ✅ Backup completes quickly
- ✅ All variables preserved
- ✅ No data loss

**Status**: ⬜ Not Tested | ✅ Passed | ❌ Failed

---

## 🔍 Bug Checklist

Before marking v1.4.0 as production-ready, verify:

- [ ] Password prompts have masked input (show dots/asterisks)
- [ ] All success messages display correctly
- [ ] Error messages are clear and actionable
- [ ] File selection UI shows backup types (🔐/🔒/📄)
- [ ] Backup files are created in correct directory
- [ ] No crashes when canceling operations
- [ ] No console errors in Developer Tools
- [ ] Extension size is reasonable
- [ ] Extension activates without errors
- [ ] No memory leaks with multiple backup operations

---

## 📝 Testing Notes

**Environment:**
- OS: _____________
- VSCode Version: _____________
- DotEnvy Version: 1.4.0
- Tested By: _____________
- Test Date: _____________

**Issues Found:**
(List any bugs or unexpected behavior)

1. ___________________________________
2. ___________________________________
3. ___________________________________

**Overall Assessment:**
⬜ Ready for Production
⬜ Minor Issues (acceptable)
⬜ Major Issues (needs fixes)

---

## 🚀 Performance Benchmarks

From automated tests:
- **PBKDF2 Key Derivation**: ~168ms average (acceptable for backups)
- **Large File Encryption** (1000 vars, 69KB): 180ms
- **Large File Decryption**: 166ms
- **Encrypted Size Overhead**: ~78% larger than original

All performance metrics are within acceptable ranges for backup operations.
