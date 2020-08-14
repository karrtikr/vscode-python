// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { fileExists } from './common/externalDependencies';
import { PartialPythonEnvironment } from './info';

export function resolvePossibleSymlinkToRealPath(interpreterPath: string) {
    // tslint:disable-next-line:no-suspicious-comment
    // TODO: Add the API to resolve symlink later
    return interpreterPath;
}

export async function isEnvironmentValid(interpreter: PartialPythonEnvironment): Promise<boolean> {
    // tslint:disable-next-line:no-suspicious-comment
    // TODO: Note that the file path may still exist but it's possible that the environment changed.
    // We may need to check file hashes here as well.
    return fileExists(interpreter.path);
}
