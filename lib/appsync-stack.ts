import { CfnOutput, Duration, Expiration, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AuthorizationType, GraphqlApi, MappingTemplate, SchemaFile } from 'aws-cdk-lib/aws-appsync';
import { join } from 'path';
import { InstanceType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AuroraMysqlEngineVersion, Credentials, DatabaseCluster, DatabaseClusterEngine, ParameterGroup, ServerlessCluster } from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';

export class AppsyncStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const appSyncApi = new GraphqlApi(this, 'Api', {
      name: 'cdk-appsync-api',
      schema: SchemaFile.fromAsset(join(__dirname, 'schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: Expiration.after(Duration.days(365)),
          },
        },
      },
      xrayEnabled: true,
    });

    const vpc = new Vpc(this, 'AuroraVpc');

    const secretStore = new Secret(this, 'AuroraSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        passwordLength: 16,
        excludeCharacters: '"@/\\',
      },
    });

    const cluster = new ServerlessCluster(this, 'AuroraCluster', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      credentials: { username: 'admin' },
      clusterIdentifier: 'ac-sdk-test',
      defaultDatabaseName: 'ac',
    });


    const dataSource = appSyncApi.addRdsDataSource('AuroraDataSource', cluster, secretStore);

    const getAllRequestTemplate = MappingTemplate.fromString(`
      {
        "version": "2017-02-28",
        "operation": "Invoke",
        "payload": {
          "sql": "SELECT * FROM ac"
        }
      }
    `);

    const getAllResponseTemplate = MappingTemplate.fromString(`
      #if($ctx.error)
        $util.error($ctx.error.message, $ctx.error.type)
      #end
      $util.toJson($ctx.result)
    `);
    
    dataSource.createResolver("getAllResolver", {
      typeName: "Query",
      fieldName: "listItems",
      requestMappingTemplate: getAllRequestTemplate,
      responseMappingTemplate: getAllResponseTemplate,
    });

    const createRequestTemplate = MappingTemplate.fromString(`
      {
        "version": "2017-02-28",
        "operation": "Invoke",
        "payload": {
          "sql": "INSERT INTO ac (name) VALUES ('$ctx.args.name')"
        }
      }
    `);

    const createResponseTemplate = MappingTemplate.fromString(`
      #if($ctx.error)
        $util.error($ctx.error.message, $ctx.error.type)
      #end
      $util.toJson($ctx.result)
    `);

    dataSource.createResolver("CreateItemInput", {
      typeName: "Mutation",
      fieldName: "createItem",
      requestMappingTemplate: createRequestTemplate,
      responseMappingTemplate: createResponseTemplate,
    });

    const deleteRequestTemplate = MappingTemplate.fromString(`
      {
        "version": "2017-02-28",
        "operation": "Invoke",
        "payload": {
          "sql": "DELETE FROM ac WHERE id = $ctx.args.id"
        }
      }
    `);

    const deleteResponseTemplate = MappingTemplate.fromString(`
      #if($ctx.error)
        $util.error($ctx.error.message, $ctx.error.type)
      #end
      $util.toJson($ctx.result)
    `);
    
    dataSource.createResolver("deleteItem", {
      typeName: "Mutation",
      fieldName: "deleteItem",
      requestMappingTemplate: deleteRequestTemplate,
      responseMappingTemplate: deleteResponseTemplate,
    });

    const updateRequestTemplate = MappingTemplate.fromString(`
      {
        "version": "2017-02-28",
        "operation": "Invoke",
        "payload": {
          "sql": "UPDATE ac SET name = '$ctx.args.name' WHERE id = $ctx.args.id"
        }
      }
    `);

    const updateResponseTemplate = MappingTemplate.fromString(`
      #if($ctx.error)
        $util.error($ctx.error.message, $ctx.error.type)
      #end
      $util.toJson($ctx.result)
    `);

    dataSource.createResolver("updateItem", {
      typeName: "Mutation",
      fieldName: "updateItem",
      requestMappingTemplate: updateRequestTemplate,
      responseMappingTemplate: updateResponseTemplate,
    });

    new CfnOutput(this, 'GraphQLAPIURL', {
      value: appSyncApi.graphqlUrl,
    });

    new CfnOutput(this, 'AuroraClusterEndpoint', {
      value: cluster.clusterEndpoint.hostname,
    });
    
  }
}
