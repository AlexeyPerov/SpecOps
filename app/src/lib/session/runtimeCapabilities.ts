/** Shipped static capability descriptors. No runtime imports or native probes. */
export function codexCapabilities() { return { schemaVersion: 1 as const, supported: ['catalogs', 'permissions', 'questions', 'nativeExtensions'], details: { nativeExtensions: { supported: true, notes: 'Verified native fork, compact lifecycle, steering, skills and bounded native config/MCP management. Legacy rollback, OAuth and plugin APIs are unavailable.' }, catalogs: { supported: true }, permissions: { supported: true }, questions: { supported: true, notes: 'Requires explicit selected-profile experimental opt-in; otherwise requests are rejected. Secret input is unsupported.' }, nativeTurns: { supported: true }, steer: { supported: true, notes: 'Native active-turn precondition, durable client identity; no fallback or replay.' }, plugins: { supported: false, notes: 'Upstream plugin APIs are under development; production list/read/install/uninstall issue no RPC.' }, mcpOAuth: { supported: false, notes: 'Native file-only credential storage is forced. Interactive OAuth/elicitation lifecycle remains unverified and unavailable.' }, rollback: { supported: false, notes: 'Pinned thread/revert supports paginated history only; selected legacy history cannot safely roll back.' } } }; }

export function opencodeCapabilities() { return {
      schemaVersion: 1 as const,
      supported: [
        "nativeExtensions" as const,
        "catalogs" as const,
        "permissions" as const,
        "questions" as const,
      ],
      details: {
        nativeExtensions: { supported: true, notes: "Bounded native views and explicit idle-session actions; configuration inspection only." },
        catalogs: { supported: true },
        permissions: { supported: true },
        questions: { supported: true },
        nativeTurns: {
          supported: true,
          notes: "Profile-bound native sessions and cancellable event streams.",
        },
      },
    }; }

export function claudeCapabilities() { return {
      schemaVersion: 1 as const,
      supported: ["catalogs" as const, "permissions" as const, "questions" as const],
      details: {
        permissions: {supported: true, notes: "Native request-scoped allow/deny; session rules only when safe suggestions exist."},
        questions: {supported: true, notes: "Native AskUserQuestion; unsupported user dialog kinds are cancelled."},
        catalogs: {
          supported: true,
          notes:
            "Native discoverable models; access is determined by the selected API key.",
        },
        nativeTurns: {
          supported: true,
          notes: "Native SDK sessions with correlated approvals and questions; installed/live acceptance remains open.",
        },
        subscriptionLogin: {
          supported: false,
          notes:
            "Third-party subscription login is unsupported. Use a dedicated API key.",
        },
        userDialogs: {supported: false, notes: "No supported dialog kinds are declared; unknown native dialogs are cancelled."},
        mcp: {supported: false, notes: "No selected servers or management surface; native MCP configuration is strict and empty."},
        skills: {supported: false, notes: "Empty native skill filter; no skill catalog or editor."},
        hooks: {supported: false, notes: "No configurable SDK hooks; user/project/local settings are excluded, managed policy may still apply."},
        subagents: {supported: false, notes: "Native built-in Agent tool remains native; dedicated subagent catalog/settings/display are unavailable."},
        commands: {supported: false, notes: "No native command catalog or execution action is exposed."},
        nativeConfiguration: {supported: true, notes: "Validated immutable session policy; filesystem setting sources excluded, native managed policy may still apply."},
        lifecycle: {supported: true, notes: "Scoped interrupt retires native query; profile reconnect increments generation and interrupts pending callbacks. Resume never replays them."},
        cloudCredentials: {
          supported: false,
          notes: "Cloud credential import is not implemented.",
        },
      },
    }; }

export function cursorCapabilities() { return {
      schemaVersion: 1 as const,
      supported: ["catalogs" as const],
      details: {
        catalogs: {
          supported: true,
          notes:
            "Official native SDK model catalog for the selected user/service API key. Model parameters come only from the selected profile native catalog.",
        },
        nativeTurns: {
          supported: true,
          limits: { localOnly: true, builtinTools: 7, attachments: false },
          notes: "Durable local native agents/runs with explicit model, tools disabled by default and finite file tool presets. File tools run without interactive approval; filesystem settings sources excluded.",
        },
        browserLogin: {
          supported: false,
          notes:
            "Official SDK browser key minting exists; its host challenge/cancel lifecycle is not implemented.",
        },
        deviceLogin: {
          supported: false,
          notes: "No native device login flow is exposed.",
        },
        permissions: {
          supported: false,
          notes:
            "Local SDK has no programmatic interactive approval callback. Native sandbox has no approval callback; file hooks are excluded.",
        },
        questions: {
          supported: false,
          notes: "No native interaction bridge is exposed.",
        },
        nativeFileTools: { supported: true, limits: { interactiveApproval: false, enforcedReadOnly: false, shell: false, task: false, mcp: false }, notes: "Finite native file tool presets only. Writes execute automatically; selected restrictions apply on every resume." },
        nativeSandbox: { supported: true, limits: { enforcementVerified: false }, notes: "Native enabled/disabled option; workspace and private profile native sandbox policy may also apply. Platform/native enforcement acceptance remains open." },
        fork: { supported: false, notes: "No verified local fork/restore lifecycle is exposed." },
        checkpoint: { supported: false, notes: "Native internal checkpoints are storage evidence, not an exposed restore action." },
        cloudExecution: {
          supported: false,
          notes:
            "Cloud execution is outside the supported local runtime scope.",
        },
        nativeConfiguration: {
          supported: true,
          notes:
            "Immutable native file tool presets, sandbox option and selected-profile catalog model parameters. Enforcement remains native/platform acceptance.",
        },
      },
    }; }
