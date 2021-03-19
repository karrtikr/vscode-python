// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';
import { getEnvironmentDirFromPath } from '../../../common/commonUtils';
import { getPythonSetting, isParentPath, pathExists, shellExecute } from '../../../common/externalDependencies';
import { isVirtualenvEnvironment } from './virtualEnvironmentIdentifier';

/**
 * Global virtual env dir for a project is named as:
 *
 * <sanitized_project_name>-<project_cwd_hash>-py<major>.<micro>
 *
 * Implementation details behind <sanitized_project_name> and <project_cwd_hash> are too
 * much to rely upon, so for our purposes the best we can do is the following regex.
 */
const globalPoetryEnvDirRegex = /^(.+)-(.+)-py(\d).(\d){1,2}$/;

/**
 * Checks if the given interpreter belongs to a global poetry environment.
 * @param {string} interpreterPath: Absolute path to the python interpreter.
 * @returns {boolean} : Returns true if the interpreter belongs to a venv environment.
 */
export async function isGlobalPoetryEnvironment(interpreterPath: string): Promise<boolean> {
    const envDir = getEnvironmentDirFromPath(interpreterPath);
    return globalPoetryEnvDirRegex.test(path.basename(envDir)) ? isVirtualenvEnvironment(interpreterPath) : false;
}

/**
 * Checks if the given interpreter belongs to a local poetry environment, i.e pipenv environment is located inside the project.
 * @param {string} interpreterPath: Absolute path to the python interpreter.
 * @returns {boolean} : Returns true if the interpreter belongs to a venv environment.
 */
export async function isLocalPoetryEnvironment(interpreterPath: string): Promise<boolean> {
    // Local poetry environments are created by the `virtualenvs.in-project` setting , which always names the environment
    // folder '.venv': https://python-poetry.org/docs/configuration/#virtualenvsin-project-boolean
    // This is the layout we wish to verify.
    // project
    // |__ pyproject.toml  <--- check if this exists
    // |__ .venv    <--- check if name of the folder is '.venv'
    //     |__ Scripts/bin
    //         |__ python  <--- interpreterPath
    const envDir = path.basename(getEnvironmentDirFromPath(interpreterPath));
    if (path.basename(envDir) !== '.venv') {
        return false;
    }
    const project = path.dirname(envDir);
    const pyprojectToml = path.join(project, 'pyproject.toml');
    if (!(await pathExists(pyprojectToml))) {
        return false;
    }
    return isPoetryEnvironmentRelatedToFolder(interpreterPath, project, getPythonSetting('poetryPath'));
}

/**
 * Checks if the given interpreter belongs to a poetry environment.
 * @param {string} interpreterPath: Absolute path to the python interpreter.
 * @returns {boolean} : Returns true if the interpreter belongs to a venv environment.
 */
export async function isPoetryEnvironment(interpreterPath: string): Promise<boolean> {
    if (await isGlobalPoetryEnvironment(interpreterPath)) {
        return true;
    }
    if (await isLocalPoetryEnvironment(interpreterPath)) {
        return true;
    }
    return false;
}

/**
 * Returns true if interpreter path belongs to a poetry environment which is associated with a particular folder,
 * false otherwise.
 * @param interpreterPath Absolute path to any python interpreter.
 * @param folder Absolute path to the folder.
 */
export async function isPoetryEnvironmentRelatedToFolder(
    interpreterPath: string,
    folder: string,
    poetryPath = 'poetry',
): Promise<boolean> {
    try {
        const result = await shellExecute(`${poetryPath} env info -p`, { timeout: 15000, cwd: folder }, undefined);
        const pathToEnv = result.stdout.trim();
        return isParentPath(interpreterPath, pathToEnv);
    } catch {
        return false; // No need to log error as this is expected if the project is not initialized for poetry.
    }
}
