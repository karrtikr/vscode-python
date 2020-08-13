// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { GetInterpreterOptions } from '../../../interpreter/interpreterService';
import { PythonInterpreter } from '../../info';

export type GetInterpreterLocatorOptions = GetInterpreterOptions & { ignoreCache?: boolean; blockOnLocators?: boolean };

export type PartialPythonEnvironment = Partial<Omit<PythonInterpreter, 'path'>> & { path: string };
