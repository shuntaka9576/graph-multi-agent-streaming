import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { AppParameter } from './config.js';
import { AgentCoreConstruct } from './constructs/agent-core-construct.js';
import { WebAppConstruct } from './constructs/web-app-construct.js';

export interface MainStackProps extends cdk.StackProps {
  config: AppParameter;
}

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const { config } = props;
    const physicalPrefix = `${config.stageName.short}-${config.projectName.short}`;

    // AgentCore
    const agentCoreConstruct = new AgentCoreConstruct(this, 'AgentCore', {
      ssmParameterName: config.ssm.agentCore.runtimeArn,
    });

    // Web App (API Gateway)
    const webAppConstruct = new WebAppConstruct(this, 'WebApp', {
      projectName: physicalPrefix,
      agentRuntimeArnSsmParam: config.ssm.agentCore.runtimeArn,
    });

    // Outputs
    new CfnOutput(this, 'AgentRuntimeArn', {
      value: agentCoreConstruct.agentRuntimeArn,
      description: 'AgentCore Runtime ARN',
    });

    new CfnOutput(this, 'WebAppUrl', {
      value: webAppConstruct.api.url,
      description: 'Web App URL (API Gateway)',
    });
  }
}
