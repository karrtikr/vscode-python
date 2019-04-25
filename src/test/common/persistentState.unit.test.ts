// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import { anything, mock, when } from 'ts-mockito';
import { Memento } from 'vscode';
import { PersistentState } from '../../client/common/persistentState';
import { MockMemento } from '../mocks/mementos';

suite('xPersistent state tests', () => {
    let persistentState: PersistentState<string>;
    let storage: Memento;
    setup(() => {
        storage = mock(MockMemento);
        persistentState = new PersistentState<string>(storage, 'UNIQUE_KEY', 'DEFAULT', 10);
    });

    test('Default data is used if cached data expiry doesn\'t exist', () => {
        const cached = { data: 'CACHED' };
        when(storage.get<{ data?: string; expiry?: number }>(anything())).thenReturn(cached);
        const data = persistentState.value;
        expect(data).to.equal('DEFAULT', 'Default data not used');
    });

    test('Default data is used if cached data has expired', () => {
        const cached = { data: 'CACHED', expiry: Date.now() - 1 };
        when(storage.get<{ data?: string; expiry?: number }>(anything())).thenReturn(cached);
        const data = persistentState.value;
        expect(data).to.equal('DEFAULT', 'Default data not used');
    });

    test('Cached data is used if cached data has not expired', () => {
        const cached = { data: 'CACHED', expiry: Date.now() + 1 };
        when(storage.get<{ data?: string; expiry?: number }>(anything())).thenReturn(cached);
        const data = persistentState.value;
        expect(data).to.equal('CACHED', 'Cached data not used');
    });

});
