export type CIPlatform =
  | "github-actions"
  | "gitlab-ci"
  | "bitbucket"
  | "circleci"
  | "local-only";

function githubActions(profile: string): string {
  return `# Build Delivery MCP — GitHub Actions wrapper
# Drop this into .github/workflows/build-delivery.yml
name: Build & Deliver

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-and-deliver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Set up Android SDK
        uses: android-actions/setup-android@v3

      - name: Build release APK
        run: ./gradlew assembleRelease

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install build-delivery-mcp
        run: npm install -g build-delivery-mcp

      - name: Deliver build
        env:
          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: \${{ secrets.TELEGRAM_CHAT_ID }}
          DEFAULT_PROFILE: ${profile}
        run: |
          APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
          # Invoke the MCP server's send_build tool via stdio (or the CLI wrapper once published).
          node -e "
            const { ConfigStore } = require('build-delivery-mcp/dist/config/store.js');
            const { DeliveryPipeline } = require('build-delivery-mcp/dist/pipeline.js');
            const { BuildHistory } = require('build-delivery-mcp/dist/history/buildHistory.js');
            (async () => {
              const config = await ConfigStore.load();
              const pipeline = new DeliveryPipeline(config, new BuildHistory());
              const out = await pipeline.process({ filePath: '$APK' });
              console.log(JSON.stringify(out.results, null, 2));
              await pipeline.shutdown();
            })();
          "
`;
}

function gitlabCi(profile: string): string {
  return `# Build Delivery MCP — GitLab CI snippet
build_and_deliver:
  image: node:20
  stage: deploy
  variables:
    DEFAULT_PROFILE: "${profile}"
  before_script:
    - apt-get update && apt-get install -y openjdk-17-jdk
    - npm install -g build-delivery-mcp
  script:
    - APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
    - |
      node -e "
        const { ConfigStore } = require('build-delivery-mcp/dist/config/store.js');
        const { DeliveryPipeline } = require('build-delivery-mcp/dist/pipeline.js');
        const { BuildHistory } = require('build-delivery-mcp/dist/history/buildHistory.js');
        (async () => {
          const c = await ConfigStore.load();
          const p = new DeliveryPipeline(c, new BuildHistory());
          await p.process({ filePath: '$APK' });
          await p.shutdown();
        })();
      "
  only:
    - main
`;
}

function bitbucket(profile: string): string {
  return `# Build Delivery MCP — Bitbucket Pipelines snippet
image: node:20
pipelines:
  default:
    - step:
        name: Build and deliver
        deployment: production
        script:
          - export DEFAULT_PROFILE="${profile}"
          - npm install -g build-delivery-mcp
          - ./gradlew assembleRelease
          - APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
          - node -e "require('build-delivery-mcp/dist/pipeline.js')"
`;
}

function circleci(profile: string): string {
  return `# Build Delivery MCP — CircleCI snippet
version: 2.1
jobs:
  deliver:
    docker:
      - image: cimg/android:2024.01-node
    environment:
      DEFAULT_PROFILE: "${profile}"
    steps:
      - checkout
      - run: ./gradlew assembleRelease
      - run: npm install -g build-delivery-mcp
      - run:
          name: Deliver
          command: |
            APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
            node -e "
              const { ConfigStore } = require('build-delivery-mcp/dist/config/store.js');
              const { DeliveryPipeline } = require('build-delivery-mcp/dist/pipeline.js');
              const { BuildHistory } = require('build-delivery-mcp/dist/history/buildHistory.js');
              (async () => {
                const c = await ConfigStore.load();
                const p = new DeliveryPipeline(c, new BuildHistory());
                await p.process({ filePath: '$APK' });
                await p.shutdown();
              })();
            "

workflows:
  build-and-deliver:
    jobs:
      - deliver
`;
}

export function emitCIWorkflow(platform: CIPlatform, profile: string): string {
  switch (platform) {
    case "github-actions":
      return githubActions(profile);
    case "gitlab-ci":
      return gitlabCi(profile);
    case "bitbucket":
      return bitbucket(profile);
    case "circleci":
      return circleci(profile);
    case "local-only":
      return "# Local-only mode — see README.md for manual invocation.\n";
  }
}
