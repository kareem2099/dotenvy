/**
 * Temporary directories for tests. Backup isolation uses dotenvy.backupPath;
 * os.homedir() is cached for the process and is not a safe switch.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTempDir(dirPath) {
    if (dirPath && fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

function listHomeBackupNames() {
    const backupRoot = path.join(os.homedir(), '.dotenvy-backups');
    if (!fs.existsSync(backupRoot)) {
        return [];
    }
    return fs.readdirSync(backupRoot).sort();
}

module.exports = {
    createTempDir,
    removeTempDir,
    listHomeBackupNames,
};
