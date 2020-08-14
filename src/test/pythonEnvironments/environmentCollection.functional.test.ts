// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as sinon from 'sinon';
import { EnvironmentsCollection } from '../../client/pythonEnvironments/environmentCollection';

suite('Environment collection', async () => {
    suite('API getEnvironments()', async () => {
        // tslint:disable-next-line:no-any
        let addPartialInfo: sinon.SinonStub<any>;

        setup(() => {
            addPartialInfo = sinon.stub(EnvironmentsCollection.prototype, '_addPartialInfo');
        });

        test('', async () => {});
    });
});
