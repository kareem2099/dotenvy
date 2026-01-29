# 🧪 Step-by-Step UI Testing Guide for v1.4.0

Follow these steps exactly to test the password-based backup feature in VS Code.

---

## 📋 Prerequisites

1. **Open VS Code** with the DotEnvy extension installed
2. **Open a workspace** with at least one `.env` file
3. **Create a test .env file** if you don't have one:
   ```bash
   # In your project root, create .env with this content:
   API_KEY=test_key_123
   DATABASE_URL=postgresql://localhost/testdb
   SECRET_TOKEN=my_secret_token
   PORT=3000
   NODE_ENV=development
   ```

---

## ✅ Test 1: Create Password-Protected Backup

### Step 1: Open DotEnvy Panel
1. Look at the **left sidebar** in VS Code
2. Find the **DotEnvy icon** (should look like a gear/settings icon)
3. **Click** on the DotEnvy icon

   **OR** use Command Palette:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type: `DotEnvy: Open Environment Panel`
   - Press Enter

### Step 2: Navigate to Backup Section
1. In the DotEnvy panel, scroll down to find the **"Backup & Recovery"** section
2. You should see a button labeled **"Backup Current Environment"**

### Step 3: Click Backup Button
1. **Click** the "Backup Current Environment" button
2. A quick pick menu should appear at the top of VS Code

### Step 4: Select Password Protection
You should see **three options**:
```
🔐 Password Protection (Recommended)
   Portable across devices - works anywhere with your password

🔒 Legacy Encryption
   Uses VSCode SecretStorage (may become inaccessible)

📄 No Encryption
   Plain text backup
```

1. **Click** on: `🔐 Password Protection (Recommended)`

### Step 5: Enter Password
An input box appears asking for password:
```
Enter a password to encrypt your backup
```

1. **Type** a test password: `TestBackup2026!`
2. **Press Enter**

**Note**: The input should be **masked** (showing dots ● instead of characters)

### Step 6: Confirm Password
Another input box appears:
```
Confirm your password
```

1. **Type** the same password: `TestBackup2026!`
2. **Press Enter**

### Step 7: Verify Success Message
At the bottom-right corner, you should see a **success notification**:
```
✅ Password-protected backup created!
📁 env.backup.2026-01-27T23-28-42.enc
🔐 This backup is portable - works on any device with your password.
```

**✅ TEST PASSED** if you see this message!

---

## ✅ Test 2: Verify Backup File Exists

### Step 1: Open Terminal in VS Code
1. Press `` Ctrl+` `` (or `Cmd+` on Mac) to open terminal
2. Or use menu: **Terminal → New Terminal**

### Step 2: Check Backup Directory
Run these commands:

**On Windows:**
```bash
cd %USERPROFILE%\.dotenvy-backups
dir
```

**On Mac/Linux:**
```bash
cd ~/.dotenvy-backups
ls -la
```

### Step 3: Verify Backup File
You should see:
1. A folder with your workspace name
2. Inside, a file like: `env.backup.2026-01-27T23-28-42.enc`

**✅ TEST PASSED** if the file exists!

---

## ✅ Test 3: Restore Password-Protected Backup

### Step 1: Open DotEnvy Panel
1. If not already open, click the **DotEnvy icon** in left sidebar

### Step 2: Click Restore Button
1. Find the **"Restore from Backup"** button (should be near the Backup button)
2. **Click** the button

### Step 3: Select Backup
A quick pick menu appears showing available backups:
```
2026-01-27T23-28-42     🔐 Password protected
   env.backup.2026-01-27T23-28-42.enc
```

1. **Click** on the backup you just created
2. Notice the **🔐 icon** indicating it's password-protected

### Step 4: Enter Password
An input box appears:
```
Enter the password used to encrypt this backup
```

1. **Type** the password: `TestBackup2026!`
2. **Press Enter**

### Step 5: Choose Restore Location
A quick pick menu appears:
```
Overwrite .env
   Replace current environment file

Create new file
   Save as .env.restored
```

1. **Click**: `Create new file` (safer for testing)

### Step 6: Verify Restoration Success
1. A success message should appear:
   ```
   ✅ Restored backup to .env.restored
   ```
2. The file `.env.restored` should **open automatically** in the editor

### Step 7: Verify Content
Check that `.env.restored` has the **exact same content** as the original `.env`:
```
API_KEY=test_key_123
DATABASE_URL=postgresql://localhost/testdb
SECRET_TOKEN=my_secret_token
PORT=3000
NODE_ENV=development
```

**✅ TEST PASSED** if content matches perfectly!

---

## ❌ Test 4: Test Wrong Password (Should Fail)

### Step 1: Try to Restore Again
1. Click **"Restore from Backup"** button
2. Select the same backup

### Step 2: Enter Wrong Password
1. Type a **different** password: `WrongPassword999!`
2. Press Enter

### Step 3: Verify Error Message
You should see an **error notification**:
```
❌ Incorrect password or corrupted backup file.
```

**✅ TEST PASSED** if you see this error (this is expected behavior)!

---

## ✅ Test 5: Test Legacy Backup (Optional)

### Step 1: Create Legacy Backup
1. Click **"Backup Current Environment"**
2. Select: `🔒 Legacy Encryption`
3. Wait for confirmation

### Step 2: Verify Warning Message
You should see a **warning**:
```
⚠️ Legacy encrypted backups use a local key. 
If VS Code data is lost, backups may become inaccessible. 
Consider using password protection instead.
```

### Step 3: Restore Legacy Backup
1. Click **"Restore from Backup"**
2. Select the backup marked with **🔒 Legacy encrypted**
3. It should restore **without asking for password**
4. Message appears: `📦 Legacy encrypted backup detected. Using VSCode SecretStorage...`

**✅ TEST PASSED** if legacy backup works without password!

---

## ✅ Test 6: Test Plaintext Backup

### Step 1: Create Plaintext Backup
1. Click **"Backup Current Environment"**
2. Select: `📄 No Encryption`
3. Wait for confirmation

### Step 2: Verify Warning
You should see:
```
Backup created: env.backup.2026-01-27T23-30-00.txt
⚠️ This backup is not encrypted.
```

### Step 3: Verify File is Readable
In terminal:
```bash
cd ~/.dotenvy-backups/<your-workspace>
cat env.backup.*.txt
```

You should be able to **read the file** as plain text.

**✅ TEST PASSED** if file is readable!

---

## ✅ Test 7: Test Password Confirmation Mismatch

### Step 1: Start Backup Creation
1. Click **"Backup Current Environment"**
2. Select: `🔐 Password Protection (Recommended)`

### Step 2: Enter Different Passwords
1. First password: `FirstPassword123!`
2. Confirmation: `DifferentPassword456!`

### Step 3: Verify Error
You should see:
```
❌ Passwords do not match. Backup cancelled.
```

**✅ TEST PASSED** if error appears and no backup is created!

---

## ✅ Test 8: Test Empty Password Validation

### Step 1: Start Backup Creation
1. Click **"Backup Current Environment"**
2. Select: `🔐 Password Protection (Recommended)`

### Step 2: Try Empty Password
1. Leave password field **empty**
2. Try to press Enter

### Step 3: Verify Validation Message
You should see **inline validation error**:
```
Password cannot be empty
```

The input should **not accept** empty password.

**✅ TEST PASSED** if validation blocks empty password!

---

## 🎯 Final Checklist

Mark each test as you complete it:

- [ ] **Test 1**: Created password-protected backup successfully
- [ ] **Test 2**: Verified backup file exists in filesystem
- [ ] **Test 3**: Restored backup with correct password
- [ ] **Test 4**: Wrong password was rejected (error shown)
- [ ] **Test 5**: Legacy backup works (optional)
- [ ] **Test 6**: Plaintext backup works
- [ ] **Test 7**: Password mismatch detected
- [ ] **Test 8**: Empty password blocked

---

## 🐛 If Something Goes Wrong

### No DotEnvy Icon in Sidebar
1. Press `Ctrl+Shift+P`
2. Type: `Developer: Reload Window`
3. Try again

### "Backup Current Environment" Button Missing
1. Make sure you have a `.env` file in your workspace
2. Refresh the panel by clicking elsewhere and back
3. Check if extension is activated: Look for "DotEnvy" in status bar

### Backup Directory Not Found
Create it manually:
```bash
# Windows
mkdir %USERPROFILE%\.dotenvy-backups

# Mac/Linux
mkdir -p ~/.dotenvy-backups
```

### Error Messages During Testing
1. Open **Developer Tools**: `Help → Toggle Developer Tools`
2. Check **Console** tab for errors
3. Report any errors found

---

## ✅ All Tests Passed?

If you successfully completed all 8 tests, congratulations! 🎉

**v1.4.0 password-based backup feature is working perfectly in the UI!**

You can now confidently:
- Create portable, password-protected backups
- Restore backups on any device
- Trust that wrong passwords are rejected
- Use the feature in production

---

## 📸 Expected UI Screenshots

### Backup Options Menu
```
┌─────────────────────────────────────────────────────┐
│ How would you like to encrypt your backup?          │
├─────────────────────────────────────────────────────┤
│ 🔐 Password Protection (Recommended)                │
│    Portable across devices - works anywhere...      │
│                                                      │
│ 🔒 Legacy Encryption                                │
│    Uses VSCode SecretStorage (may become...)        │
│                                                      │
│ 📄 No Encryption                                    │
│    Plain text backup                                │
└─────────────────────────────────────────────────────┘
```

### Password Input
```
┌─────────────────────────────────────────────────────┐
│ Enter a password to encrypt your backup             │
├─────────────────────────────────────────────────────┤
│ ●●●●●●●●●●●●●●●                                     │
│ Enter password (min 8 characters recommended)       │
└─────────────────────────────────────────────────────┘
```

### Restore Backup Selection
```
┌─────────────────────────────────────────────────────┐
│ Select backup to restore                            │
├─────────────────────────────────────────────────────┤
│ 2026-01-27T23-28-42     🔐 Password protected       │
│    env.backup.2026-01-27T23-28-42.enc              │
│                                                      │
│ 2026-01-27T22-15-30     🔒 Legacy encrypted         │
│    env.backup.2026-01-27T22-15-30.legacy.enc       │
│                                                      │
│ 2026-01-27T21-00-00     📄 Plain text               │
│    env.backup.2026-01-27T21-00-00.txt              │
└─────────────────────────────────────────────────────┘
```

---

**Happy Testing! 🚀**
