/**
 * Compares a local cloud-key map with a remote map. Remote metadata keys are dropped first.
 */

import { CloudSecrets } from './cloudSyncManager';
import { EnvSyncUtils } from './envSyncUtils';

export interface CloudSecretDiff {
	remoteOnly: string[];
	localOnly: string[];
	changed: string[];
}

/**
 * Lists keys only in the filtered remote map, only in local, or present in both with different values.
 */
export function diffCloudSecrets(local: CloudSecrets, remote: CloudSecrets): CloudSecretDiff {
	const filteredRemote = EnvSyncUtils.filterCloudMetadataKeys(
		EnvSyncUtils.filterDopplerReservedKeys(remote)
	);

	const remoteOnly: string[] = [];
	const localOnly: string[] = [];
	const changed: string[] = [];

	for (const [key, remoteValue] of Object.entries(filteredRemote)) {
		if (!Object.prototype.hasOwnProperty.call(local, key)) {
			remoteOnly.push(key);
			continue;
		}
		if (local[key] !== remoteValue) {
			changed.push(key);
		}
	}

	for (const key of Object.keys(local)) {
		if (!Object.prototype.hasOwnProperty.call(filteredRemote, key)) {
			localOnly.push(key);
		}
	}

	return { remoteOnly, localOnly, changed };
}
