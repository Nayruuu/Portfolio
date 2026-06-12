import type { Lang } from '../../domain';

import angularDeferControlFlowFr from '../../../content/articles/angular-defer-control-flow.fr.md';
import angularDeferControlFlowEn from '../../../content/articles/angular-defer-control-flow.en.md';
import angularResourceHttpresourceFr from '../../../content/articles/angular-resource-httpresource.fr.md';
import angularResourceHttpresourceEn from '../../../content/articles/angular-resource-httpresource.en.md';
import angularSignalstoreNgrxFr from '../../../content/articles/angular-signalstore-ngrx.fr.md';
import angularSignalstoreNgrxEn from '../../../content/articles/angular-signalstore-ngrx.en.md';
import angularSsgAzureStaticWebAppsFr from '../../../content/articles/angular-ssg-azure-static-web-apps.fr.md';
import angularSsgAzureStaticWebAppsEn from '../../../content/articles/angular-ssg-azure-static-web-apps.en.md';
import angularZonelessSignalsFr from '../../../content/articles/angular-zoneless-signals.fr.md';
import angularZonelessSignalsEn from '../../../content/articles/angular-zoneless-signals.en.md';
import azureContainerAppsDotnetFr from '../../../content/articles/azure-container-apps-dotnet.fr.md';
import azureContainerAppsDotnetEn from '../../../content/articles/azure-container-apps-dotnet.en.md';
import azureKeyVaultManagedIdentityFr from '../../../content/articles/azure-key-vault-managed-identity.fr.md';
import azureKeyVaultManagedIdentityEn from '../../../content/articles/azure-key-vault-managed-identity.en.md';
import cqrsVerticalSlicesDotnetFr from '../../../content/articles/cqrs-vertical-slices-dotnet.fr.md';
import cqrsVerticalSlicesDotnetEn from '../../../content/articles/cqrs-vertical-slices-dotnet.en.md';
import dockerMultistageDotnetAngularFr from '../../../content/articles/docker-multistage-dotnet-angular.fr.md';
import dockerMultistageDotnetAngularEn from '../../../content/articles/docker-multistage-dotnet-angular.en.md';
import dotnetGrpcMicroservicesFr from '../../../content/articles/dotnet-grpc-microservices.fr.md';
import dotnetGrpcMicroservicesEn from '../../../content/articles/dotnet-grpc-microservices.en.md';
import dotnetSourceGeneratorsFr from '../../../content/articles/dotnet-source-generators.fr.md';
import dotnetSourceGeneratorsEn from '../../../content/articles/dotnet-source-generators.en.md';
import etranglerLeMonolitheDotnetFr from '../../../content/articles/etrangler-le-monolithe-dotnet.fr.md';
import etranglerLeMonolitheDotnetEn from '../../../content/articles/etrangler-le-monolithe-dotnet.en.md';
import flutterFirebaseOfflineFirstFr from '../../../content/articles/flutter-firebase-offline-first.fr.md';
import flutterFirebaseOfflineFirstEn from '../../../content/articles/flutter-firebase-offline-first.en.md';
import flutterMelosMonorepoFr from '../../../content/articles/flutter-melos-monorepo.fr.md';
import flutterMelosMonorepoEn from '../../../content/articles/flutter-melos-monorepo.en.md';
import flutterRiverpodArchitectureFr from '../../../content/articles/flutter-riverpod-architecture.fr.md';
import flutterRiverpodArchitectureEn from '../../../content/articles/flutter-riverpod-architecture.en.md';
import minimalApiEfCoreDotnet8Fr from '../../../content/articles/minimal-api-ef-core-dotnet8.fr.md';
import minimalApiEfCoreDotnet8En from '../../../content/articles/minimal-api-ef-core-dotnet8.en.md';
import opentelemetryObservabiliteDotnetFr from '../../../content/articles/opentelemetry-observabilite-dotnet.fr.md';
import opentelemetryObservabiliteDotnetEn from '../../../content/articles/opentelemetry-observabilite-dotnet.en.md';
import pipelineCicdGithubActionsAzureFr from '../../../content/articles/pipeline-cicd-github-actions-azure.fr.md';
import pipelineCicdGithubActionsAzureEn from '../../../content/articles/pipeline-cicd-github-actions-azure.en.md';
import testerAngularZonelessVitestFr from '../../../content/articles/tester-angular-zoneless-vitest.fr.md';
import testerAngularZonelessVitestEn from '../../../content/articles/tester-angular-zoneless-vitest.en.md';
import tutoGitRebaseInteractifFr from '../../../content/articles/tuto-git-rebase-interactif.fr.md';
import tutoGitRebaseInteractifEn from '../../../content/articles/tuto-git-rebase-interactif.en.md';

/** slug → raw Markdown body per language. Single source for render + prerender. */
export const ARTICLE_BODIES: Record<string, Record<Lang, string>> = {
  'angular-defer-control-flow': { fr: angularDeferControlFlowFr, en: angularDeferControlFlowEn },
  'angular-resource-httpresource': {
    fr: angularResourceHttpresourceFr,
    en: angularResourceHttpresourceEn,
  },
  'angular-signalstore-ngrx': { fr: angularSignalstoreNgrxFr, en: angularSignalstoreNgrxEn },
  'angular-ssg-azure-static-web-apps': {
    fr: angularSsgAzureStaticWebAppsFr,
    en: angularSsgAzureStaticWebAppsEn,
  },
  'angular-zoneless-signals': { fr: angularZonelessSignalsFr, en: angularZonelessSignalsEn },
  'azure-container-apps-dotnet': { fr: azureContainerAppsDotnetFr, en: azureContainerAppsDotnetEn },
  'azure-key-vault-managed-identity': {
    fr: azureKeyVaultManagedIdentityFr,
    en: azureKeyVaultManagedIdentityEn,
  },
  'cqrs-vertical-slices-dotnet': { fr: cqrsVerticalSlicesDotnetFr, en: cqrsVerticalSlicesDotnetEn },
  'docker-multistage-dotnet-angular': {
    fr: dockerMultistageDotnetAngularFr,
    en: dockerMultistageDotnetAngularEn,
  },
  'dotnet-grpc-microservices': { fr: dotnetGrpcMicroservicesFr, en: dotnetGrpcMicroservicesEn },
  'dotnet-source-generators': { fr: dotnetSourceGeneratorsFr, en: dotnetSourceGeneratorsEn },
  'etrangler-le-monolithe-dotnet': {
    fr: etranglerLeMonolitheDotnetFr,
    en: etranglerLeMonolitheDotnetEn,
  },
  'flutter-firebase-offline-first': {
    fr: flutterFirebaseOfflineFirstFr,
    en: flutterFirebaseOfflineFirstEn,
  },
  'flutter-melos-monorepo': { fr: flutterMelosMonorepoFr, en: flutterMelosMonorepoEn },
  'flutter-riverpod-architecture': {
    fr: flutterRiverpodArchitectureFr,
    en: flutterRiverpodArchitectureEn,
  },
  'minimal-api-ef-core-dotnet8': { fr: minimalApiEfCoreDotnet8Fr, en: minimalApiEfCoreDotnet8En },
  'opentelemetry-observabilite-dotnet': {
    fr: opentelemetryObservabiliteDotnetFr,
    en: opentelemetryObservabiliteDotnetEn,
  },
  'pipeline-cicd-github-actions-azure': {
    fr: pipelineCicdGithubActionsAzureFr,
    en: pipelineCicdGithubActionsAzureEn,
  },
  'tester-angular-zoneless-vitest': {
    fr: testerAngularZonelessVitestFr,
    en: testerAngularZonelessVitestEn,
  },
  'tuto-git-rebase-interactif': { fr: tutoGitRebaseInteractifFr, en: tutoGitRebaseInteractifEn },
};
