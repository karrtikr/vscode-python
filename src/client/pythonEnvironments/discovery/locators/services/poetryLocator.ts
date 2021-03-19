// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { uniq } from 'lodash';
import * as path from 'path';
import { Uri } from 'vscode';
import { traceVerbose } from '../../../../common/logger';
import { chain, iterable } from '../../../../common/utils/async';
import { PythonEnvInfo, PythonEnvKind, PythonEnvSource } from '../../../base/info';
import { buildEnvInfo } from '../../../base/info/env';
import { IPythonEnvsIterator } from '../../../base/locator';
import { FSWatchingLocator } from '../../../base/locators/lowLevel/fsWatchingLocator';
import {
    findInterpretersInDir,
    getEnvironmentDirFromPath,
    getPythonVersionFromPath,
    looksLikeBasicVirtualPython,
} from '../../../common/commonUtils';
import { getFileInfo, pathExists } from '../../../common/externalDependencies';
import { isPoetryEnvironment } from './poetry';

/**
 * Default number of levels of sub-directories to recurse when looking for interpreters.
 */
const DEFAULT_SEARCH_DEPTH = 2;

/**
 * Gets all default virtual environment locations to look for in a workspace.
 */
async function getVirtualEnvDirs(root: string): Promise<string[]> {
    const envDirs: string[] = [];
    return [...envDirs, path.join(root, '.venv')].filter(pathExists);
}

async function getVirtualEnvRootDirs(): Promise<string[]> {
    return [];
}

async function getVirtualEnvKind(interpreterPath: string): Promise<PythonEnvKind> {
    return (await isPoetryEnvironment(interpreterPath)) ? PythonEnvKind.Poetry : PythonEnvKind.Unknown;
}

async function buildSimpleVirtualEnvInfo(
    executablePath: string,
    kind: PythonEnvKind,
    source?: PythonEnvSource[],
): Promise<PythonEnvInfo> {
    const envInfo = buildEnvInfo({
        kind,
        version: await getPythonVersionFromPath(executablePath),
        executable: executablePath,
        source: source ?? [PythonEnvSource.Other],
    });
    const location = getEnvironmentDirFromPath(executablePath);
    envInfo.location = location;
    envInfo.name = path.basename(location);
    // Search location particularly for virtual environments is intended as the
    // directory in which the environment was found in. For eg. the default search location
    // for an env containing 'bin' or 'Scripts' directory is:
    //
    // searchLocation <--- Default search location directory
    // |__ env
    //    |__ bin or Scripts
    //        |__ python  <--- executable
    envInfo.searchLocation = Uri.file(path.dirname(location));

    // TODO: Call a general display name provider here to build display name.
    const fileData = await getFileInfo(executablePath);
    envInfo.executable.ctime = fileData.ctime;
    envInfo.executable.mtime = fileData.mtime;
    return envInfo;
}

/**
 * Finds and resolves virtual environments created in workspace roots.
 */
export class PoetryLocator extends FSWatchingLocator {
    public constructor(private readonly root: string) {
        super(
            () => getVirtualEnvRootDirs(),
            async () => PythonEnvKind.Poetry,
        );
    }

    protected doIterEnvs(): IPythonEnvsIterator {
        async function* iterator(root: string) {
            const envRootDirs = await getVirtualEnvDirs(root);
            const envGenerators = envRootDirs.map((envRootDir) => {
                async function* generator() {
                    traceVerbose(`Searching for poetry virtual envs in: ${envRootDir}`);

                    const executables = findInterpretersInDir(envRootDir, DEFAULT_SEARCH_DEPTH);

                    for await (const entry of executables) {
                        const { filename } = entry;
                        // We only care about python.exe (on windows) and python (on linux/mac)
                        // Other version like python3.exe or python3.8 are often symlinks to
                        // python.exe or python in the same directory in the case of virtual
                        // environments.
                        if (await looksLikeBasicVirtualPython(entry)) {
                            // We should extract the kind here to avoid doing is*Environment()
                            // check multiple times. Those checks are file system heavy and
                            // we can use the kind to determine this anyway.
                            const kind = await getVirtualEnvKind(filename);
                            yield buildSimpleVirtualEnvInfo(filename, kind);
                            traceVerbose(`Poetry Virtual Environment: [added] ${filename}`);
                        } else {
                            traceVerbose(`Poetry Virtual Environment: [skipped] ${filename}`);
                        }
                    }
                }
                return generator();
            });

            yield* iterable(chain(envGenerators));
        }

        return iterator(this.root);
    }

    // eslint-disable-next-line class-methods-use-this
    protected async doResolveEnv(env: string | PythonEnvInfo): Promise<PythonEnvInfo | undefined> {
        const executablePath = typeof env === 'string' ? env : env.executable.filename;
        const source = typeof env === 'string' ? [PythonEnvSource.Other] : uniq([PythonEnvSource.Other, ...env.source]);
        const kind = await getVirtualEnvKind(executablePath);
        if (kind === PythonEnvKind.Poetry) {
            return buildSimpleVirtualEnvInfo(executablePath, PythonEnvKind.Poetry, source);
        }
        return undefined;
    }
}
