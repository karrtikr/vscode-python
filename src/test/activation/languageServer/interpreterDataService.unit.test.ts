// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { instance, mock, verify, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { Memento, Uri } from 'vscode';
import { InterpreterDataService } from '../../../client/activation/languageServer/interpreterDataService';
import { InterpreterData } from '../../../client/activation/types';
import { PythonExecutionFactory } from '../../../client/common/process/pythonExecutionFactory';
import { PythonExecutionService } from '../../../client/common/process/pythonProcess';
import { ExecutionResult, IPythonExecutionFactory, IPythonExecutionService } from '../../../client/common/process/types';
import { IExtensionContext } from '../../../client/common/types';
import { ServiceContainer } from '../../../client/ioc/container';
import { IServiceContainer } from '../../../client/ioc/types';
import { MockMemento } from '../../mocks/mementos';

suite('xActivation - Interpreter Data Service', () => {
    let context: typemoq.IMock<IExtensionContext>;
    let serviceContainer: IServiceContainer;
    let interpreterDataService: InterpreterDataService;
    let executionfactory: IPythonExecutionFactory;
    let execService: IPythonExecutionService;
    let memento: Memento;

    setup(() => {
        context = typemoq.Mock.ofType<IExtensionContext>();
        serviceContainer = mock(ServiceContainer);
        executionfactory = mock(PythonExecutionFactory);
        execService = mock(PythonExecutionService);
        memento = mock(MockMemento);
        interpreterDataService = new InterpreterDataService(context.object, instance(serviceContainer));
    });
    test('Python execution service is called to get interpreter data when data is changed', async () => {
        const resource = Uri.parse('one');
        const interpreterPath = 'path/to/interpreter';
        const interpreterData: InterpreterData = {
            dataVersion: 2,
            path: '',
            version: '',
            searchPaths: '',
            hash: ''
        };
        const result: ExecutionResult<string> = {
            stdout: undefined
        };
        when(serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory)).thenReturn(instance(executionfactory));
        when(executionfactory.create({ resource })).thenResolve(instance(execService));
        when(execService.getExecutablePath()).thenResolve(interpreterPath);
        context
            .setup(p => p.globalState)
            .returns(() => instance(memento));
        when(memento.get<InterpreterData>('')).thenReturn(interpreterData);
        when(execService.exec(['-c', 'import sys; print(sys.version_info)'], {})).thenResolve(result);
        interpreterDataService.getInterpreterData(resource);
        verify(execService.exec(['-c', 'import sys; print(sys.version_info)'], {})).once();
    });
});
