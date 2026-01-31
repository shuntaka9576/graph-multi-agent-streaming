import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as assets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AgentCoreConstructProps {
  ssmParameterName: string;
}

export class AgentCoreConstruct extends Construct {
  public readonly agentRuntimeArn: string;
  public readonly ssmParamName: string;

  constructor(scope: Construct, id: string, props: AgentCoreConstructProps) {
    super(scope, id);

    this.ssmParamName = props.ssmParameterName;

    const agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'agent'),
      {
        platform: assets.Platform.LINUX_ARM64,
      }
    );

    const agentCoreRuntime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: 'myAgent',
      agentRuntimeArtifact: agentRuntimeArtifact,
    });

    agentCoreRuntime.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );

    this.agentRuntimeArn = agentCoreRuntime.agentRuntimeArn;

    new ssm.StringParameter(this, 'RuntimeArnParam', {
      parameterName: props.ssmParameterName,
      stringValue: agentCoreRuntime.agentRuntimeArn,
      description: 'AgentCore Runtime ARN',
    });
  }
}
