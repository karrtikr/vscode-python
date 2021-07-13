// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { uniq } from 'lodash';
import * as path from 'path';
import { traceError, traceVerbose } from '../../../../common/logger';
import { chain, iterable } from '../../../../common/utils/async';
import { getUserHomeDir } from '../../../../common/utils/platform';
import { PythonEnvKind } from '../../../base/info';
import { BasicEnvInfo, IPythonEnvsIterator } from '../../../base/locator';
import { FSWatchingLocator } from '../../../base/locators/lowLevel/fsWatchingLocator';
import { findInterpretersInDir, looksLikeBasicVirtualPython } from '../../../common/commonUtils';
import {
    getPythonSetting,
    onDidChangePythonSetting,
    pathExists,
    untildify,
} from '../../../common/externalDependencies';
import { isPipenvEnvironment } from './pipEnvHelper';
import {
    isVenvEnvironment,
    isVirtualenvEnvironment,
    isVirtualenvwrapperEnvironment,
} from './virtualEnvironmentIdentifier';
import '../../../../common/extensions';
import { asyncFilter } from '../../../../common/utils/arrayUtils';
/**
 * Default number of levels of sub-directories to recurse when looking for interpreters.
 */
const DEFAULT_SEARCH_DEPTH = 2;

export const VENVPATH_SETTING_KEY = 'venvPath';
export const VENVFOLDERS_SETTING_KEY = 'venvFolders';

/**
 * Gets all custom virtual environment locations to look for environments.
 */
async function getCustomVirtualEnvDirs(): Promise<string[]> {
    const venvDirs: string[] = [];
    const venvPath = getPythonSetting<string>(VENVPATH_SETTING_KEY);
    if (venvPath) {
        venvDirs.push(untildify(venvPath));
    }
    const venvFolders = getPythonSetting<string[]>(VENVFOLDERS_SETTING_KEY) ?? [];
    const homeDir = getUserHomeDir();
    if (homeDir && (await pathExists(homeDir))) {
        venvFolders.map((item) => path.join(homeDir, item)).forEach((d) => venvDirs.push(d));
    }
    return asyncFilter(uniq(venvDirs), pathExists);
}

/**
 * Gets the virtual environment kind for a given interpreter path.
 * This only checks for environments created using venv, virtualenv,
 * and virtualenvwrapper based environments.
 * @param interpreterPath: Absolute path to the interpreter paths.
 */
async function getVirtualEnvKind(interpreterPath: string): Promise<PythonEnvKind> {
    if (await isPipenvEnvironment(interpreterPath)) {
        return PythonEnvKind.Pipenv;
    }

    if (await isVirtualenvwrapperEnvironment(interpreterPath)) {
        return PythonEnvKind.VirtualEnvWrapper;
    }

    if (await isVenvEnvironment(interpreterPath)) {
        return PythonEnvKind.Venv;
    }

    if (await isVirtualenvEnvironment(interpreterPath)) {
        return PythonEnvKind.VirtualEnv;
    }

    return PythonEnvKind.Unknown;
}

/**
 * Finds and resolves custom virtual environments that users have provided.
 */
export class CustomVirtualEnvironmentLocator extends FSWatchingLocator<BasicEnvInfo> {
    constructor() {
        super(getCustomVirtualEnvDirs, getVirtualEnvKind, {
            // Note detecting kind of virtual env depends on the file structure around the
            // executable, so we need to wait before attempting to detect it. However even
            // if the type detected is incorrect, it doesn't do any practical harm as kinds
            // in this locator are used in the same way (same activation commands etc.)
            delayOnCreated: 1000,
        });
    }

    protected async initResources(): Promise<void> {
        this.disposables.push(onDidChangePythonSetting(VENVPATH_SETTING_KEY, () => this.emitter.fire({})));
        this.disposables.push(onDidChangePythonSetting(VENVFOLDERS_SETTING_KEY, () => this.emitter.fire({})));
    }

    // eslint-disable-next-line class-methods-use-this
    protected doIterEnvs(): IPythonEnvsIterator<BasicEnvInfo> {
        async function* iterator() {
            const envRootDirs = await getCustomVirtualEnvDirs();
            const envGenerators = envRootDirs.map((envRootDir) => {
                async function* generator() {
                    traceVerbose(`Searching for custom virtual envs in: ${envRootDir}`);

                    const executables = findInterpretersInDir(envRootDir, DEFAULT_SEARCH_DEPTH);

                    for await (const entry of executables) {
                        const { filename } = entry;
                        // We only care about python.exe (on windows) and python (on linux/mac)
                        // Other version like python3.exe or python3.8 are often symlinks to
                        // python.exe or python in the same directory in the case of virtual
                        // environments.
                        if (await looksLikeBasicVirtualPython(entry)) {
                            try {
                                // We should extract the kind here to avoid doing is*Environment()
                                // check multiple times. Those checks are file system heavy and
                                // we can use the kind to determine this anyway.
                                const kind = await getVirtualEnvKind(filename);
                                yield { kind, executablePath: filename };
                                traceVerbose(`Custom Virtual Environment: [added] ${filename}`);
                            } catch (ex) {
                                traceError(`Failed to process environment: ${filename}`, ex);
                            }
                        } else {
                            traceVerbose(`Custom Virtual Environment: [skipped] ${filename}`);
                        }
                    }
                }
                return generator();
            });

            yield* iterable(chain(envGenerators));
        }

        return iterator();
    }
}
