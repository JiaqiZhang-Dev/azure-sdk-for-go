# How to Create a Management Service Using TypeSpec

This guide provides step-by-step instructions for creating Azure management plane (ARM) services using TypeSpec for the Azure SDK for Go.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Step 1: Create TypeSpec Definition in azure-rest-api-specs](#step-1-create-typespec-definition-in-azure-rest-api-specs)
- [Step 2: Set Up Go SDK Module](#step-2-set-up-go-sdk-module)
- [Step 3: Generate the SDK](#step-3-generate-the-sdk)
- [Step 4: Add Tests and Examples](#step-4-add-tests-and-examples)
- [Step 5: Create Release Pipeline](#step-5-create-release-pipeline)
- [References](#references)

## Overview

TypeSpec is the modern way to define Azure APIs and generate SDKs. For management plane services, you'll:

1. Define your service in TypeSpec in the `azure-rest-api-specs` repository
2. Configure the Go SDK generation settings
3. Create the SDK module structure in `azure-sdk-for-go`
4. Generate the Go SDK code using `tsp-client`
5. Add tests, examples, and documentation

## Prerequisites

### Required Tools

Install the following tools before starting:

1. **Go** (latest or latest-1 version)
   ```bash
   # Download from https://go.dev/doc/install
   ```

2. **Node.js** (LTS version)
   ```bash
   # On Windows: winget install OpenJS.NodeJS.LTS
   # Or download from https://nodejs.org/
   ```

3. **TypeSpec Compiler**
   ```bash
   npm install -g @typespec/compiler
   ```

4. **tsp-client**
   ```bash
   npm install -g @azure-tools/typespec-client-generator-cli
   ```

### Repository Setup

1. Fork and clone the repositories:
   ```bash
   # Fork and clone azure-rest-api-specs
   git clone https://github.com/<your-username>/azure-rest-api-specs.git
   
   # Fork and clone azure-sdk-for-go
   git clone https://github.com/<your-username>/azure-sdk-for-go.git
   ```

2. Ensure your directory structure looks like:
   ```
   <prefix-path>/
   ├── Azure/
   │   ├── azure-rest-api-specs/
   │   └── azure-sdk-for-go/
   ```

## Step 1: Create TypeSpec Definition in azure-rest-api-specs

### 1.1 Create TypeSpec Project Structure

In the `azure-rest-api-specs` repository, create your service directory following the Azure REST API specs convention:

```
specification/<organization>/resource-manager/<RPNS>/<service>/
├── main.tsp                      # Service definition and imports
├── tspconfig.yaml               # Compiler configuration
├── <resource-name>.tsp          # Resource definitions
├── models.tsp                   # Model definitions
├── routes.tsp                   # Route definitions
├── client.tsp                   # Optional: Client customizations
├── back-compatible.tsp          # Optional: Backward compatibility
├── stable/<apiVersion>/
│   ├── <service>.json          # Generated OpenAPI spec
│   └── examples/               # Example files
├── preview/<apiVersion-preview>/
│   ├── <service>.json          # Generated preview OpenAPI spec
│   └── examples/               # Preview example files
└── readme.md                    # Service documentation
```

This structure separates models, resource operations, routes, and configuration for maintainability and compliance.

### 1.2 Define Your Service in main.tsp

Create a basic management plane service with proper structure:

```typespec
import "@typespec/rest";
import "@typespec/http";
import "@typespec/versioning";
import "@azure-tools/typespec-azure-core";
import "@azure-tools/typespec-azure-resource-manager";

using TypeSpec.Rest;
using TypeSpec.Http;
using TypeSpec.Versioning;
using Azure.Core;
using Azure.ResourceManager;

@armProviderNamespace
@service({
  title: "My Service Management",
})
@versioned(Versions)
@armCommonTypesVersion(Azure.ResourceManager.CommonTypes.Versions.v5)
namespace Microsoft.MyService;

/** API versions */
enum Versions {
  /** 2024-01-01-preview API version */
  @useDependency(Azure.ResourceManager.Versions.v1_0_Preview_1)
  @useDependency(Azure.Core.Versions.v1_0_Preview_2)
  "2024-01-01-preview",
}

// Define your resources, models, and operations here

/** The properties of MyResource */
model MyResourceProperties {
  /** Current provisioning state */
  provisioningState?: ProvisioningState;
  
  /** Resource color */
  color?: string;
  
  // Add your properties with documentation
}

/** A MyResource Resource */
@resource("myResources")
model MyResource is TrackedResource<MyResourceProperties> {
  /** The name of the resource */
  @key("myResourceName")
  @segment("myResources")
  @path
  name: string;
}

// Standard ARM operations using templates
@armResourceOperations
interface MyResources {
  /** Get a MyResource by name */
  get is ArmResourceRead<MyResource>;
  
  /** Create or update a MyResource */
  createOrUpdate is ArmResourceCreateOrReplaceAsync<MyResource>;
  
  /** Update a MyResource */
  update is ArmCustomPatchSync<
    MyResource, 
    Azure.ResourceManager.Foundations.ResourceUpdateModel<MyResource, MyResourceProperties>
  >;
  
  /** Delete a MyResource */
  delete is ArmResourceDeleteSync<MyResource>;
  
  /** List MyResources by resource group */
  listByResourceGroup is ArmResourceListByParent<MyResource>;
  
  /** List MyResources by subscription */
  listBySubscription is ArmListBySubscription<MyResource>;
}

// Add Operations interface for standard ARM operations
interface Operations extends Azure.ResourceManager.Operations {}
```

**Key Best Practices:**
- Always document all models, properties, and operations with `/** */` comments
- Use standard ARM resource templates (TrackedResource, ProxyResource, etc.)
- Use standard operation templates (ArmResourceRead, ArmResourceCreateOrReplaceAsync, etc.)
- Include the Operations interface for standard ARM operations
- Use `@armResourceOperations` decorator on resource operation interfaces

### 1.3 Configure tspconfig.yaml

Add Go generation configuration to your `tspconfig.yaml` with all required options:

```yaml
parameters:
  "service-dir":
    default: "sdk/resourcemanager/<service-name>/arm<service-name>"

emit:
  - "@azure-tools/typespec-autorest"
  - "@azure-tools/typespec-go"

options:
  "@azure-tools/typespec-autorest":
    azure-resource-provider-folder: "resource-manager"
    emitter-output-dir: "{output-dir}"
    examples-directory: "{project-root}/examples"
    omit-unreachable-types: true
    output-file: "{azure-resource-provider-folder}/{service-name}/{version-status}/{version}/openapi.json"

  "@azure-tools/typespec-go":
    module: "github.com/Azure/azure-sdk-for-go/{service-dir}"
    service-dir: "{service-dir}"
    emitter-output-dir: "{output-dir}/{service-dir}"
    containing-module: true
    generate-samples: true
    generate-fakes: true
    head-as-boolean: true
    inject-spans: true
    rawjson-as-bytes: true

linter:
  extends:
    - "@azure-tools/typespec-azure-rulesets/resource-manager"
```

**Required Go Emitter Options:**
- `module`: The Go module path (e.g., `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/myservice/armmyservice`)
- `service-dir`: The service directory path relative to repo root
- `emitter-output-dir`: Where to generate the SDK code
- `containing-module`: Set to `true` for proper module structure
- `generate-samples`: Set to `true` to generate example code
- `generate-fakes`: Set to `true` to generate fake servers for testing
- `head-as-boolean`: Set to `true` to convert HEAD operations to boolean returns
- `inject-spans`: Set to `true` to add OpenTelemetry span injection
- `rawjson-as-bytes`: Set to `true` to handle raw JSON as byte arrays

All these options are required to pass Azure SDK validation.

### 1.4 (Optional) Add Client Customizations in client.tsp

If you need to customize the generated client, create a `client.tsp` file. This is where you place all SDK customizations:

```typespec
import "./main.tsp";
import "@azure-tools/typespec-client-generator-core";

using Azure.ClientGenerator.Core;

namespace ClientCustomizations;

// Common Customizations:

// 1. Rename clients or operations
@@clientName(Microsoft.MyService.MyResources, "MyResourceClient");
@@clientName(Microsoft.MyService.myOperation, "MyBetterOperation");

// 2. Go-specific naming
@@clientName(Microsoft.MyService.MyModel, "GoModel", "go");

// 3. Hide internal operations
@@access(Microsoft.MyService.InternalOp, Access.internal);

// 4. Move operations to different clients
@@clientLocation(Microsoft.MyService.SubGroup.operation, Microsoft.MyService);

// 5. Change client namespace/package
@@clientNamespace(Microsoft.MyService, "myservice.v1");

// 6. Define custom clients for better organization
@client({ name: "AdminClient", service: Microsoft.MyService })
interface AdminClient {
  // Define operations for admin client
  adminOp is Microsoft.MyService.adminOperation;
}

@operationGroup
interface MyOperationGroup {
  // Define operations for sub-client
  list is Microsoft.MyService.listResources;
  get is Microsoft.MyService.getResource;
}
```

**Key Decorators:**
- `@client`: Define root clients (use on interface in client.tsp)
- `@operationGroup`: Define sub-clients/operation groups
- `@@clientName`: Rename elements (use "go" as scope for Go-specific names)
- `@@clientLocation`: Move operations between clients
- `@@clientNamespace`: Control package structure
- `@@access`: Control visibility (public/internal)
- `@override`: Customize operation signatures

**Important Notes:**
- Always place customizations in `client.tsp`, never in `main.tsp`
- Use `@@` prefix for augmentation decorators (applied to existing types)
- Use `@` prefix for direct decorators (applied during definition)
- Cannot use `@client`/`@operationGroup` with `@@clientLocation` on the same operation
- Add a file-level namespace when defining types in client.tsp

## Step 2: Set Up Go SDK Module

### 2.1 Create Directory Structure

In the `azure-sdk-for-go` repository, create the module structure:

```bash
cd azure-sdk-for-go
mkdir -p sdk/resourcemanager/<service-name>/arm<service-name>
cd sdk/resourcemanager/<service-name>/arm<service-name>
```

Directory naming convention:
- Management plane: `sdk/resourcemanager/<group>/arm<service>`
- Example: `sdk/resourcemanager/dashboard/armdashboard`

### 2.2 Create Required Files

Copy template files from `sdk/template/aztemplate` and update them:

**go.mod**
```go
module github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/<service-name>/arm<service-name>

go 1.24.0

require (
    github.com/Azure/azure-sdk-for-go/sdk/azcore v1.20.0
    github.com/Azure/azure-sdk-for-go/sdk/azidentity v1.13.1
)
```

**CHANGELOG.md**
```markdown
# Release History

## 1.0.0-beta.1 (Unreleased)

### Features Added

- Initial preview release of the <Service Name> management SDK

### Breaking Changes

- N/A

### Bugs Fixed

- N/A

### Other Changes

- N/A
```

**README.md**
```markdown
# Azure <Service Name> Module for Go

The `arm<service-name>` module provides operations for working with Azure <Service Name>.

[Source code](https://github.com/Azure/azure-sdk-for-go/tree/main/sdk/resourcemanager/<service-name>/arm<service-name>)

## Getting started

### Prerequisites

- an [Azure subscription](https://azure.microsoft.com/free/)
- Go 1.24 or above

### Install the package

```bash
go get github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/<service-name>/arm<service-name>
```

### Authorization

Use [azidentity](https://github.com/Azure/azure-sdk-for-go/tree/main/sdk/azidentity) to authenticate:

```go
cred, err := azidentity.NewDefaultAzureCredential(nil)
```

## Key concepts

This module provides a client for managing <Service Name> resources.

## Examples

See the [examples directory](https://github.com/Azure/azure-sdk-for-go/tree/main/sdk/resourcemanager/<service-name>/arm<service-name>/_examples) for complete examples.

## Contributing

See [CONTRIBUTING.md](https://github.com/Azure/azure-sdk-for-go/blob/main/CONTRIBUTING.md).
```

**ci.yml**
```yaml
# NOTE: Please refer to https://aka.ms/azsdk/engsys/ci-yaml before editing this file.
trigger:
  branches:
    include:
      - main
      - feature/*
      - hotfix/*
      - release/*
  paths:
    include:
    - sdk/resourcemanager/<service-name>/arm<service-name>/

pr:
  branches:
    include:
      - main
      - feature/*
      - hotfix/*
      - release/*
  paths:
    include:
    - sdk/resourcemanager/<service-name>/arm<service-name>/

extends:
  template: /eng/pipelines/templates/jobs/archetype-sdk-client.yml
  parameters:
    ServiceDirectory: 'resourcemanager/<service-name>/arm<service-name>'
```

**LICENSE.txt**
```
Copyright (c) Microsoft Corporation.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 2.3 Create tsp-location.yaml

This file links your SDK to the TypeSpec source:

```yaml
directory: specification/<service-name>/<ServiceName>.Management
commit: <commit-hash-from-azure-rest-api-specs>
repo: Azure/azure-rest-api-specs
additionalDirectories:
```

To get the commit hash:
```bash
cd azure-rest-api-specs
git log -1 --format="%H"
```

### 2.4 Create version.go

The release pipeline requires a version constant:

```go
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.
// Code generated by Microsoft (R) AutoRest Code Generator. DO NOT EDIT.
// Changes may cause incorrect behavior and will be lost if the code is regenerated.

package arm<service-name>

const (
	moduleName    = "github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/<service-name>/arm<service-name>"
	moduleVersion = "v1.0.0-beta.1"
)
```

## Step 3: Generate the SDK

### 3.1 Run tsp-client

From your module directory:

```bash
cd azure-sdk-for-go/sdk/resourcemanager/<service-name>/arm<service-name>
tsp-client update
```

To use a local TypeSpec project (for development):
```bash
tsp-client update --local-spec-repo /path/to/azure-rest-api-specs
```

### 3.2 Verify Generated Files

After generation, you should have:
- `client_factory.go` - Client factory for creating service clients
- `*_client.go` - Client implementations for each resource type
- `models.go` - Model definitions
- `models_serde.go` - JSON serialization
- `constants.go` - Enums and constants
- `responses.go` - Response types
- `options.go` - Options for operations

### 3.3 Build and Verify

```bash
go build ./...
go vet ./...
go fmt ./...
```

## Step 4: Add Tests and Examples

### 4.1 Create Example Tests

Create files like `*_client_example_test.go`:

```go
package arm<service-name>_test

import (
	"context"
	"log"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/<service-name>/arm<service-name>"
)

func ExampleMyResourcesClient_Get() {
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		log.Fatalf("failed to obtain a credential: %v", err)
	}
	ctx := context.TODO()
	clientFactory, err := arm<service-name>.NewClientFactory("<subscription-id>", cred, nil)
	if err != nil {
		log.Fatalf("failed to create client: %v", err)
	}
	res, err := clientFactory.NewMyResourcesClient().Get(ctx, "resourceGroupName", "resourceName", nil)
	if err != nil {
		// TODO: Update the following line with your application specific error handling logic
		log.Fatalf("ERROR: %s", err)
	}
	// TODO: Use response item
	_ = res
}
```

**Important**: Always use `context.TODO()` in examples (not `context.Background()`).

### 4.2 Add Unit Tests (Optional)

Create `*_test.go` files for unit tests as needed.

## Step 5: Create Release Pipeline

### 5.1 Initialize CI Pipeline

1. Create a PR with your changes
2. Add a comment to initialize the pipeline:
   ```
   /azp run prepare-pipelines
   ```

This creates the CI pipelines for your module.

## Regenerating the SDK

When you update the TypeSpec definition:

1. Update the commit hash in `tsp-location.yaml`
2. Run `tsp-client update` or use `go generate`:
   ```bash
   cd sdk/resourcemanager/<service-name>/arm<service-name>
   go generate
   ```
3. Update examples for new operations
4. Update CHANGELOG.md with changes

## Best Practices

### TypeSpec

- Follow Azure Resource Manager conventions
- Use standard resource types (TrackedResource, ProxyResource, etc.)
- Include proper versioning
- Add comprehensive documentation

### Go SDK

- Don't modify generated code directly
- Use `client.tsp` for customizations
- Follow Go naming conventions (will be applied automatically)
- Add comprehensive examples for all operations
- Use `context.TODO()` in examples (not `context.Background()`)

### Testing

- Test all CRUD operations
- Include error handling examples
- Test pagination for list operations
- Add live tests for integration testing

## Troubleshooting

### tsp-client not found

Ensure Node.js and tsp-client are properly installed:
```bash
npm install -g @azure-tools/typespec-client-generator-cli
```

### Generation errors

Check the TypeSpec compiler output for errors:
```bash
cd azure-rest-api-specs/specification/<service>/
tsp compile .
```

### Go build errors

Ensure all dependencies are up to date:
```bash
go mod tidy
```

## References

### Documentation

- [TypeSpec Website](https://typespec.io/)
- [Azure SDK Go Guidelines](https://azure.github.io/azure-sdk/golang_introduction.html)
- [Development Setup](./setup.md)
- [SDK Generation Guide](./generate.md)
- [Testing Guide](./testing.md)
- [TypeSpec Customizations](../../eng/common/knowledge/customizing-client-tsp.md)

### Examples

- [Dashboard SDK](../../sdk/resourcemanager/dashboard/armdashboard/) - TypeSpec-based management service
- [Chaos SDK](../../sdk/resourcemanager/chaos/armchaos/) - Another TypeSpec example
- [All TypeSpec Services](../../sdk/resourcemanager/) - Browse other examples

### Tools

- [tsp-client GitHub](https://github.com/Azure/azure-sdk-tools/tree/main/tools/tsp-client)
- [TypeSpec Azure Resource Manager](https://github.com/Azure/typespec-azure/tree/main/packages/typespec-azure-resource-manager)
- [TypeSpec Client Generator](https://github.com/Azure/typespec-azure/tree/main/packages/typespec-client-generator-core)

### Getting Help

- Contact the Go SDK team: azsdkgo@microsoft.com
- File issues: [azure-sdk-for-go issues](https://github.com/Azure/azure-sdk-for-go/issues)
- TypeSpec questions: [TypeSpec discussions](https://github.com/microsoft/typespec/discussions)
