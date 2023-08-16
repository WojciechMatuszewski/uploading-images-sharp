import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import path from "path";

class Stack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const imagesBucket = new cdk.aws_s3.Bucket(this, "ImagesBucket", {
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
			objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
			eventBridgeEnabled: true,
		});
		imagesBucket.addCorsRule({
			allowedMethods: [
				cdk.aws_s3.HttpMethods.POST,
				cdk.aws_s3.HttpMethods.GET,
				cdk.aws_s3.HttpMethods.PUT,
			],
			allowedOrigins: ["*"],
			allowedHeaders: ["*"],
		});
		new cdk.CfnOutput(this, "ImagesBucketName", {
			value: imagesBucket.bucketName,
		});

		const imagesTable = new cdk.aws_dynamodb.Table(this, "ImagesTable", {
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			partitionKey: {
				name: "pk",
				type: cdk.aws_dynamodb.AttributeType.STRING,
			},
			billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
		});

		const api = new cdk.aws_apigateway.RestApi(this, "Api", {
			defaultCorsPreflightOptions: {
				allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
				allowMethods: cdk.aws_apigateway.Cors.ALL_METHODS,
				allowCredentials: false,
			},
		});

		const createPresignedPostHandler = new cdk.aws_lambda_nodejs.NodejsFunction(
			this,
			"CreatePresignedPostHandler",
			{
				entry: path.join(__dirname, "../src/createPresignedPost.ts"),
				handler: "handler",
				bundling: {
					format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
				},
				runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
				environment: {
					IMAGES_BUCKET_NAME: imagesBucket.bucketName,
				},
			}
		);
		imagesBucket.grantReadWrite(createPresignedPostHandler);
		api.root
			.addResource("create-presigned-post")
			.addMethod(
				"POST",
				new cdk.aws_apigateway.LambdaIntegration(createPresignedPostHandler)
			);

		const saveImageEntryToDynamoDBTask =
			new cdk.aws_stepfunctions_tasks.DynamoPutItem(this, "SaveImageEntry", {
				table: imagesTable,
				item: {
					/**
					 * original_01H7S3FH5MKK4SN20TPKGQ9EPK.jpeg => 01H7S3FH5MKK4SN20TPKGQ9EPK
					 * 1. Remove the `original_` prefix from the key
					 * 2. Remove the `.jpeg` extension from the key
					 */
					pk: cdk.aws_stepfunctions_tasks.DynamoAttributeValue.fromString(
						cdk.aws_stepfunctions.JsonPath.arrayGetItem(
							cdk.aws_stepfunctions.JsonPath.stringSplit(
								cdk.aws_stepfunctions.JsonPath.arrayGetItem(
									cdk.aws_stepfunctions.JsonPath.stringSplit(
										cdk.aws_stepfunctions.JsonPath.stringAt("$.key"),
										"original_"
									),
									0
								),
								"."
							),
							0
						)
					),
					images: cdk.aws_stepfunctions_tasks.DynamoAttributeValue.fromMap({
						original:
							cdk.aws_stepfunctions_tasks.DynamoAttributeValue.fromString(
								cdk.aws_stepfunctions.JsonPath.stringAt("$.key")
							),
					}),
				},
				resultPath: cdk.aws_stepfunctions.JsonPath.DISCARD,
			});

		const sharpLayer = new cdk.aws_lambda.LayerVersion(this, "SharpLayer", {
			code: cdk.aws_lambda.Code.fromAsset(
				path.join(__dirname, "./layers/sharp")
			),
			compatibleRuntimes: [cdk.aws_lambda.Runtime.NODEJS_18_X],
		});

		const manipulateImageHandler = new cdk.aws_lambda_nodejs.NodejsFunction(
			this,
			"ManipulateImageHandler",
			{
				entry: path.join(__dirname, "../src/manipulateImage.ts"),
				layers: [sharpLayer],
				bundling: {
					externalModules: ["sharp"],
				},
				memorySize: 1024,
				timeout: cdk.Duration.seconds(30),
			}
		);
		imagesBucket.grantReadWrite(manipulateImageHandler);

		const normalizeImageTask = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
			this,
			"NormalizeImage",
			{
				lambdaFunction: manipulateImageHandler,
				payload: cdk.aws_stepfunctions.TaskInput.fromObject({
					bucket: cdk.aws_stepfunctions.JsonPath.stringAt("$.bucket"),
					key: cdk.aws_stepfunctions.JsonPath.stringAt("$.key"),
					operation: "normalize",
				}),
				payloadResponseOnly: true,
				resultPath: "$.normalized",
			}
		);

		const createBlurHashFromImageTask =
			new cdk.aws_stepfunctions_tasks.LambdaInvoke(this, "CreateBlurHash", {
				lambdaFunction: manipulateImageHandler,
				payload: cdk.aws_stepfunctions.TaskInput.fromObject({
					bucket: cdk.aws_stepfunctions.JsonPath.stringAt("$.bucket"),
					key: cdk.aws_stepfunctions.JsonPath.stringAt("$.key"),
					operation: "blurHash",
				}),
				payloadResponseOnly: true,
				resultPath: "$.blurHash",
			});

		const imageManipulation = new cdk.aws_stepfunctions.Parallel(
			this,
			"ImageManipulation",
			{
				resultSelector: {
					bucket: cdk.aws_stepfunctions.JsonPath.stringAt("$[0].bucket"),
					normalized:
						cdk.aws_stepfunctions.JsonPath.stringAt("$[0].normalized"),
					blurHash: cdk.aws_stepfunctions.JsonPath.stringAt("$[1].blurHash"),
				},
			}
		)
			.branch(normalizeImageTask)
			.branch(createBlurHashFromImageTask);

		const updateImageEntryInDBTask =
			new cdk.aws_stepfunctions_tasks.DynamoUpdateItem(
				this,
				"UpdateImageEntry",
				{
					key: {
						pk: cdk.aws_stepfunctions_tasks.DynamoAttributeValue.fromString(
							cdk.aws_stepfunctions.JsonPath.arrayGetItem(
								cdk.aws_stepfunctions.JsonPath.stringSplit(
									cdk.aws_stepfunctions.JsonPath.arrayGetItem(
										cdk.aws_stepfunctions.JsonPath.stringSplit(
											cdk.aws_stepfunctions.JsonPath.stringAt("$.normalized"),
											"normalized_"
										),
										0
									),
									"."
								),
								0
							)
						),
					},
					table: imagesTable,
					expressionAttributeNames: {
						"#normalized": "normalized",
						"#blurHash": "blurHash",
						"#images": "images",
					},
					expressionAttributeValues: {
						":normalized":
							cdk.aws_stepfunctions_tasks.DynamoAttributeValue.fromString(
								cdk.aws_stepfunctions.JsonPath.stringAt("$.normalized")
							),
						":blurHash":
							cdk.aws_stepfunctions_tasks.DynamoAttributeValue.fromString(
								cdk.aws_stepfunctions.JsonPath.stringAt("$.blurHash")
							),
					},
					updateExpression:
						"SET #images.#normalized = :normalized, #images.#blurHash = :blurHash",
				}
			);

		const imageStateMachine = new cdk.aws_stepfunctions.StateMachine(
			this,
			"ImageStateMachine",
			{
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tracingEnabled: true,
				stateMachineType: cdk.aws_stepfunctions.StateMachineType.STANDARD,
				definitionBody: cdk.aws_stepfunctions.DefinitionBody.fromChainable(
					saveImageEntryToDynamoDBTask
						.next(imageManipulation)
						.next(updateImageEntryInDBTask)
				),
			}
		);

		const imageUploadedRule = new cdk.aws_events.Rule(
			this,
			"ImageUploadedRule",
			{
				eventPattern: {
					source: ["aws.s3"],
					detailType: ["Object Created"],
					detail: {
						bucket: {
							name: [imagesBucket.bucketName],
						},
						object: {
							key: [{ prefix: "original" }],
						},
					},
				},
			}
		);
		const imageUploadedRuleTarget = new cdk.aws_events_targets.SfnStateMachine(
			imageStateMachine,
			{
				retryAttempts: 0,
				input: cdk.aws_events.RuleTargetInput.fromObject({
					bucket: cdk.aws_events.EventField.fromPath("$.detail.bucket.name"),
					key: cdk.aws_events.EventField.fromPath("$.detail.object.key"),
				}),
			}
		);
		imageUploadedRule.addTarget(imageUploadedRuleTarget);
	}
}

const app = new cdk.App();
new Stack(app, "BackendStack", {
	synthesizer: new cdk.DefaultStackSynthesizer({
		qualifier: "miniinsta",
	}),
});
