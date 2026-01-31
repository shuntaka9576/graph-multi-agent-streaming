#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { getConfig } from '../lib/config.js';
import { MainStack } from '../lib/main-stack.js';

const REGIONS = {
  TOKYO: 'ap-northeast-1',
} as const;

const app = new cdk.App();

// Get stage name from context (e.g., `cdk deploy -c stageName=dev`)
const stageName = app.node.tryGetContext('stageName');
if (!stageName) {
  throw new Error('stageName context is required. Use: cdk deploy -c stageName=dev');
}

const config = getConfig(stageName);
const stackPrefix = `${config.stageName.short}-${config.projectName.short}`;

// MainStack (ap-northeast-1) - Main application resources
new MainStack(app, `${stackPrefix}-main`, {
  env: {
    account: config.cdkEnv.account,
    region: REGIONS.TOKYO,
  },
  config,
});

app.synth();
