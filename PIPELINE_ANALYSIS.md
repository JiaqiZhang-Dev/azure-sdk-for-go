# Azure Cosmos DB (armcosmos) Pipeline Analysis

## Overview
This document provides a comprehensive analysis of the CI/CD pipeline for the `armcosmos` module located at `sdk/resourcemanager/cosmos/armcosmos/`.

## Pipeline Configuration

### Location
- **CI Configuration**: `sdk/resourcemanager/cosmos/armcosmos/ci.yml`
- **Module Path**: `sdk/resourcemanager/cosmos/armcosmos/`
- **Service Directory**: `resourcemanager/cosmos/armcosmos`

### Pipeline Triggers

#### Branch Triggers
The pipeline is triggered on commits to:
- `main`
- `feature/*`
- `hotfix/*`
- `release/*`

#### Path Filters
Pipeline only runs when changes are made to:
- `sdk/resourcemanager/cosmos/armcosmos/`

#### Pull Request Triggers
The pipeline runs on pull requests targeting:
- `main`
- `feature/*`
- `hotfix/*`
- `release/*`

## Pipeline Architecture

### Template Structure
The pipeline extends from:
```yaml
/eng/pipelines/templates/stages/1es-redirect.yml
  └── /eng/pipelines/templates/jobs/archetype-sdk-client.yml
      ├── Build Stage
      │   ├── CI Tests (Build/Test jobs)
      │   └── Analyze job
      ├── Live Test Stage (internal only)
      └── Release Stages (internal only)
```

### Configuration Parameters
- **UsePipelineProxy**: `false`
- **ServiceDirectory**: `resourcemanager/cosmos/armcosmos`
- **Go Version**: `1.23.2` (as specified in analyze job)
- **Test Runtime**: `600s` (default)
- **EnableRaceDetector**: `false` (default)

## Build Stage

### 1. CI Tests Job

#### Platform Matrix
The pipeline runs tests on:
- **Linux** (using LinuxPool with LinuxVMImage)
- **Windows** (using WindowsPool with WindowsVMImage)

#### Steps Performed
1. **Sparse Checkout**: Only checks out relevant service directory files
2. **Go Version Selection**: Installs Go 1.23.2
3. **Go Workspace Creation**: Sets up Go workspace
4. **Build**: Executes `eng/scripts/build.ps1`
   - Builds all packages in the service directory
   - Supports filtering with `-filter` parameter
5. **Vet**: Runs `go vet` on all packages
   - Executes `eng/scripts/build.ps1 -vet -skipBuild`
6. **Test**: Runs unit tests
   - Command: `go test -timeout 600s -v -coverprofile coverage.txt ./...`
   - Generates JUnit report using `go-junit-report`
   - Creates coverage reports
   - Test results published to Azure DevOps
   - **Mode**: Playback mode (`AZURE_RECORD_MODE=playback`)
   - **Test Proxy**: Not enabled for armcosmos
7. **Build Performance Tests**: Validates performance test compilation

### 2. Analyze Job

The Analyze job performs comprehensive code quality checks:

#### Static Analysis & Linting
1. **Spelling Check**: Validates spelling in code and documentation
2. **Component Detection**: Identifies dependencies (non-PR builds only)
3. **golangci-lint**: Runs comprehensive linting
   - Version: As specified in `$(GoLintCLIVersion)`
   - Config: `eng/.golangci.yml`
4. **Format Check**: Verifies `gofmt` compliance
5. **Copyright Header Check**: Ensures all files have proper copyright headers
6. **LICENSE.txt Check**: Validates license files

#### Code Quality Checks
1. **go mod tidy**: Ensures `go.mod` and `go.sum` are clean
2. **go get -u all**: Checks for dependency update issues (when enabled)
3. **Dependency Check**: Validates dependencies
4. **doc.go Verification**: Ensures documentation files exist

#### Documentation & Links
1. **Verify Links**: Checks for broken links in markdown files
2. **Documentation Validation**: Runs doccheck tool
3. **Changelog Verification**: Validates CHANGELOG.md format and content

#### API Management
1. **APIView Generation**: Creates API review artifacts
2. **API Change Detection**: Detects breaking API changes in PRs
3. **Package Validation**: Validates package metadata

#### CodeQL Analysis
- **Enabled**: Yes (`Codeql.Enabled: true`)
- **Build Identifier**: Uses service directory as identifier
- **Purpose**: Security vulnerability scanning

## Live Tests

**Status**: Not enabled by default for armcosmos
- Only runs in internal pipelines with `RunLiveTests: true`
- Requires manual trigger via `/azp run` comment
- Supports multiple cloud environments (Public, Government, etc.)

## Test Infrastructure

### Test Types Present
1. **Example Tests**: `*_example_test.go` files
   - Test that examples compile and run
   - Not executed in actual test runs
2. **Live Tests**: `*_live_test.go` files
   - Tests against actual Azure resources
   - Uses test-proxy for recording/playback
   - Currently in playback mode for CI

### Test Assets
- **Location**: `.proxy/` directory
- **Source**: Azure SDK assets repository
- **Tag**: `go/resourcemanager/cosmos/armcosmos_6b5b7eed9c`

### Test Proxy
- **Version**: `1.0.0-dev.20251209.1`
- **Port**: `27301`
- **Mode**: Playback (recordings used instead of live calls)

## Build Scripts

### Key Scripts
1. **build.ps1**: Handles building Go modules
   - Supports code generation via autorest
   - Supports cleaning, vetting, and formatting
2. **run_tests.ps1**: Orchestrates test execution
   - Calls `test.ps1` for each package
   - Aggregates results
3. **test.ps1**: Executes tests for a single module
   - Runs tests with coverage
   - Generates JUnit reports
   - Validates coverage thresholds

## Module Information

### Current Version
- **Version**: `v3.4.0` (released 2025-11-12)
- **Latest Changes**: Added Fleet and Fleetspace functionality

### Dependencies
- `github.com/Azure/azure-sdk-for-go/sdk/azcore`
- `github.com/Azure/azure-sdk-for-go/sdk/azidentity` (for tests)
- `github.com/stretchr/testify` (for tests)

### Package Structure
- **Main Package**: `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/v3`
- **Fake Package**: `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/v3/fake`

## Common Issues & Troubleshooting

### Build Issues
1. **Go Module Issues**: Run `go mod tidy` locally
2. **Linting Failures**: Run `golangci-lint run -c eng/.golangci.yml` locally
3. **Format Issues**: Run `gofmt -w .` or `go fmt ./...`

### Test Issues
1. **Test Proxy Not Found**: Tests will automatically download it
2. **Recording Issues**: Ensure test-proxy is running and recordings exist
3. **Timeout Issues**: Default timeout is 600s, can be adjusted

### Analysis Issues
1. **Copyright Header Failures**: Add proper headers to new files
2. **Documentation Issues**: Ensure all public types have documentation
3. **Changelog Issues**: Update CHANGELOG.md following the format

## Best Practices

### For Contributors
1. **Before Committing**:
   - Run `go build ./...` to ensure code builds
   - Run `go test ./...` to ensure tests pass
   - Run `go mod tidy` to clean dependencies
   - Run `gofmt -w .` to format code
   - Run `golangci-lint run` to check for linting issues

2. **For PRs**:
   - Update CHANGELOG.md if making user-facing changes
   - Add examples for new functionality
   - Ensure copyright headers are present
   - Verify documentation is complete

3. **Testing**:
   - Write unit tests for new functionality
   - Use the fake package for client testing
   - Ensure tests work in playback mode

## Pipeline Health Indicators

### Success Criteria
- ✅ Build succeeds on Linux and Windows
- ✅ All tests pass (unit tests)
- ✅ Code coverage meets threshold
- ✅ Linting passes with no errors
- ✅ No broken links in documentation
- ✅ CHANGELOG.md is properly formatted
- ✅ No security vulnerabilities detected by CodeQL

### Common Failure Points
1. **Linting Errors**: Most common - check golangci-lint output
2. **Test Failures**: Check test output and recordings
3. **Format Issues**: Run gofmt locally
4. **Documentation Issues**: Ensure public APIs are documented
5. **Dependency Issues**: Check go.mod/go.sum consistency

## Current Status

### Build Status
- **Local Build**: ✅ Passing
- **Local Tests**: ✅ Passing (no test files found in main module)
- **Module**: Uses example tests in separate `*_example_test.go` files

### Recent Changes
- Latest commit on main: `9d276fe1` - Remove Invoke-ToolDescriptionEvaluator script

## Recommendations

1. **Test Coverage**: Consider adding more unit tests beyond examples
2. **Live Tests**: The module has live tests but they require Azure resources
3. **Documentation**: Keep README.md and examples up to date
4. **Dependencies**: Regularly update dependencies to latest stable versions
5. **Performance**: Monitor test execution time and optimize if needed

## Additional Resources

- **Pipeline Template**: `/eng/pipelines/templates/jobs/archetype-sdk-client.yml`
- **Build Scripts**: `/eng/scripts/`
- **Common Scripts**: `/eng/common/scripts/`
- **Linting Config**: `/eng/.golangci.yml`
- **Coverage Config**: `/eng/config.json`

---

**Last Updated**: 2025-12-18
**Analyzed Build**: Local analysis (Azure DevOps build 5670015 not directly accessible)
**Module Version**: v3.4.0
