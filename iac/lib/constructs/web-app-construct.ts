import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WebAppConstructProps {
  projectName: string;
  agentRuntimeArnSsmParam: string;
  ssmParameters?: {
    apiGatewayUrl?: string;
  };
}

export class WebAppConstruct extends Construct {
  public readonly lambdaFunction: lambda.Function;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: WebAppConstructProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // CloudWatch Logs
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${props.projectName}-web`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Lambda Execution Role
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // SSM Parameter access
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter${props.agentRuntimeArnSsmParam}`,
        ],
      })
    );

    // AgentCore Runtime access
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: ['*'],
      })
    );

    // Lambda Web Adapter Layer (ARM64)
    const webAdapterLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'WebAdapterLayer',
      `arn:aws:lambda:${stack.region}:753240598075:layer:LambdaAdapterLayerArm64:25`
    );

    // Lambda Function
    this.lambdaFunction = new lambda.Function(this, 'Function', {
      functionName: `${props.projectName}-web`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '..',
          'apps',
          'server',
          'dist'
        )
      ),
      layers: [webAdapterLayer],
      memorySize: 256,
      timeout: cdk.Duration.minutes(15),
      role: lambdaRole,
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        PORT: '3000',
        NODE_ENV: 'production',
        AGENT_RUNTIME_ARN_SSM_PARAM: props.agentRuntimeArnSsmParam,
      },
      logGroup,
    });

    // API Gateway REST API
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${props.projectName}-api`,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: 'prod',
      },
    });

    // Lambda Integration with streaming mode
    const lambdaIntegration = new apigateway.LambdaIntegration(this.lambdaFunction, {
      proxy: true,
      responseTransferMode: apigateway.ResponseTransferMode.STREAM,
      timeout: cdk.Duration.minutes(15),
    });

    // Root path integration
    this.api.root.addMethod('ANY', lambdaIntegration);

    // Proxy all paths to Lambda
    this.api.root.addProxy({
      defaultIntegration: lambdaIntegration,
      anyMethod: true,
    });

    // SSM Parameter for API Gateway URL
    if (props.ssmParameters?.apiGatewayUrl) {
      new ssm.StringParameter(this, 'SsmApiGatewayUrl', {
        parameterName: props.ssmParameters.apiGatewayUrl,
        stringValue: this.api.url,
      });
    }

  }
}
