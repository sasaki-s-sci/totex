//! Observers that speak ACP over stdio (OpenCode, or a custom executable).
//! The session gets no MCP servers and no permissions; the terminal snapshot
//! arrives inside the prompt as data.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use agent_client_protocol::schema::{
    ProtocolVersion,
    v1::{
        InitializeRequest, NewSessionRequest, RequestPermissionOutcome, RequestPermissionRequest,
        RequestPermissionResponse, SessionConfigKind, SessionConfigOption,
        SessionConfigOptionCategory, SessionConfigSelectOption, SessionConfigSelectOptions,
        SetSessionConfigOptionRequest,
    },
};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Client, Error};
use totex_host::host::Host;

use super::{
    Model,
    launch::{Workspace, flagged},
};

fn process_config(command: &std::process::Command) -> AcpAgentConfig {
    AcpAgentConfig::new(command.get_program())
        .args(
            command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned()),
        )
        .envs(command.get_envs().filter_map(|(key, value)| {
            value.map(|value| {
                (
                    key.to_string_lossy().into_owned(),
                    value.to_string_lossy().into_owned(),
                )
            })
        }))
}

fn choices(option: &SessionConfigOption) -> Vec<&SessionConfigSelectOption> {
    match &option.kind {
        SessionConfigKind::Select(select) => match &select.options {
            SessionConfigSelectOptions::Ungrouped(options) => options.iter().collect(),
            SessionConfigSelectOptions::Grouped(groups) => groups
                .iter()
                .flat_map(|group| group.options.iter())
                .collect(),
            _ => vec![],
        },
        _ => vec![],
    }
}

fn model_option(options: &[SessionConfigOption]) -> Option<&SessionConfigOption> {
    options
        .iter()
        .find(|option| matches!(option.category, Some(SessionConfigOptionCategory::Model)))
}

/// A mode selector offering `plan`, which is the read-only mode where an
/// agent has one; observers never need to act.
fn plan_option(options: &[SessionConfigOption]) -> Option<&SessionConfigOption> {
    options.iter().find(|option| {
        (matches!(option.category, Some(SessionConfigOptionCategory::Mode))
            || &*option.id.0 == "mode")
            && choices(option)
                .iter()
                .any(|choice| &*choice.value.0 == "plan")
    })
}

/// The models an agent's model selector offers, grouped or not, and the one
/// it currently has.
pub(super) fn models_of(options: &[SessionConfigOption]) -> (Vec<Model>, Option<String>) {
    let Some(option) = model_option(options) else {
        return (vec![], None);
    };
    let models = choices(option)
        .into_iter()
        .map(|choice| Model {
            id: choice.value.0.to_string(),
            name: choice.name.clone(),
            description: choice.description.clone(),
        })
        .collect();
    let current = match &option.kind {
        SessionConfigKind::Select(select) => Some(select.current_value.0.to_string()),
        _ => None,
    };
    (models, current)
}

/// One prompt turn, answered with the agent's whole text reply.
pub(super) async fn observe(
    argv: &[&str],
    model: &str,
    host: &Host,
    environment: &str,
    prompt: String,
) -> Result<String, String> {
    let workspace = Workspace::prepare(host, environment, argv[0], &[]).await?;
    let agent = AcpAgent::new(process_config(&workspace.command(argv)));
    let directory = workspace.directory().clone();
    let permission_requested = Arc::new(AtomicBool::new(false));
    let requested = permission_requested.clone();
    let connection = Client
        .builder()
        .name("totex-monitor")
        .on_receive_request(
            async move |_request: RequestPermissionRequest, responder, _cx| {
                requested.store(true, Ordering::Release);
                responder.respond(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, async |cx| {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            cx.build_session_from(NewSessionRequest::new(directory))
                .block_task()
                .run_until(async |mut session| {
                    let options = session.config_options().unwrap_or_default().to_vec();
                    let mut settings = vec![];
                    if !model.is_empty() {
                        let option = model_option(&options).ok_or_else(|| {
                            Error::invalid_params()
                                .data("This agent does not expose a model selector through ACP")
                        })?;
                        settings.push((option.id.clone(), model.to_owned()));
                    }
                    if let Some(option) = plan_option(&options) {
                        settings.push((option.id.clone(), "plan".to_owned()));
                    }
                    for (id, value) in settings {
                        session
                            .connection()
                            .send_request(SetSessionConfigOptionRequest::new(
                                session.session_id().clone(),
                                id,
                                value.as_str(),
                            ))
                            .block_task()
                            .await?;
                    }
                    session.send_prompt(prompt)?;
                    session.read_to_string().await
                })
                .await
        });
    let response = tokio::select! {
        result = connection => result,
        _ = flagged(&permission_requested) => Err(Error::request_cancelled()),
    };
    if permission_requested.load(Ordering::Acquire) {
        return Err("Permission required: Monitor is read-only; the observer permission request was cancelled".into());
    }
    response.map_err(|e| e.to_string())
}

/// The model selector of a fresh session; no prompt is sent.
pub(super) async fn models(
    argv: &[&str],
    host: &Host,
    environment: &str,
) -> Result<(Vec<Model>, Option<String>), String> {
    let workspace = Workspace::prepare(host, environment, argv[0], &[]).await?;
    let agent = AcpAgent::new(process_config(&workspace.command(argv)));
    let directory = workspace.directory().clone();
    let options = Client
        .builder()
        .name("totex-monitor")
        .connect_with(agent, async |cx| {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            cx.build_session_from(NewSessionRequest::new(directory))
                .block_task()
                .run_until(async |session| {
                    Ok(session.config_options().unwrap_or_default().to_vec())
                })
                .await
        })
        .await
        .map_err(|e| e.to_string())?;
    if model_option(&options).is_none() {
        return Err("This agent does not expose a model selector through ACP".into());
    }
    Ok(models_of(&options))
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::{Config, Features, Observer, observation};
    use super::*;
    use serde_json::{Value, json};
    use std::time::Duration;

    const FAKE: &str = r#"
import json, os, sys
mode = sys.argv[1]
settings = {}
def emit(value):
    print(json.dumps(value), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method')
    params = request.get('params', {})
    if method == 'initialize':
        assert params['protocolVersion'] == 1
        result = {'protocolVersion':1,'agentCapabilities':{}}
    elif method == 'session/new':
        assert '/totex/monitor/' in params['cwd']
        assert os.getcwd() == params['cwd']
        assert params.get('mcpServers', []) == []
        result = {'sessionId':'test','configOptions':[
            {'id':'model','name':'Model','category':'model','type':'select','currentValue':'default','options':[
                {'group':'p1','name':'Provider one','options':[{'value':'default','name':'Default','description':'Balanced'}]},
                {'group':'p2','name':'Provider two','options':[{'value':'test-model','name':'Test'}]}]},
            {'id':'mode','name':'Mode','category':'mode','type':'select','currentValue':'build','options':[
                {'value':'build','name':'Build'},{'value':'plan','name':'Plan'}]}]}
    elif method == 'session/set_config_option':
        settings[params['configId']] = params['value']
        result = {'configOptions':[]}
    elif method == 'session/prompt':
        assert settings == {'model':'test-model','mode':'plan'}, settings
        prompt = params['prompt'][0]['text']
        assert 'Implement Unicode 日本語' in prompt
        assert 'taskSummary:' in prompt and 'estimate' not in prompt
        if mode == 'permission':
            emit({'jsonrpc':'2.0','id':'permission','method':'session/request_permission','params':{'sessionId':'test','toolCall':{'toolCallId':'write','title':'Write a file','kind':'edit','status':'pending'},'options':[]}})
            continue
        if mode == 'stall':
            open(sys.argv[2], 'w').write(json.dumps({'pid':os.getpid(),'cwd':os.getcwd()}))
            continue
        text = 'Looking.\n' + json.dumps({'status':'running','taskSummary':'Unicode task','estimate':{'seconds':1,'confidence':'high'}})
        emit({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':'test','update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':text}}}})
        result = {'stopReason':'end_turn'}
    else:
        continue
    emit({'jsonrpc':'2.0','id':request['id'],'result':result})
"#;

    fn config(mode: &str) -> Config {
        Config {
            enabled: true,
            agent: Observer::Custom,
            command: "python3".into(),
            args: vec!["-u".into(), "-c".into(), FAKE.into(), mode.into()],
            model: "test-model".into(),
            features: Features {
                status: true,
                task_summary: true,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    async fn observed(config: &Config, cancelled: Arc<AtomicBool>) -> Result<Value, String> {
        observation(
            config,
            &Host::Local,
            "Local",
            "Implement Unicode 日本語",
            cancelled,
            None,
        )
        .await
    }

    #[tokio::test]
    async fn acp_sets_model_and_plan_mode_and_filters_features() {
        let report = tokio::time::timeout(
            Duration::from_secs(15),
            observed(&config("report"), Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            report,
            json!({"status":"running","taskSummary":"Unicode task"})
        );
    }

    #[tokio::test]
    async fn acp_models_flatten_grouped_options() {
        let config = config("models");
        let argv: Vec<&str> = std::iter::once(config.command.as_str())
            .chain(config.args.iter().map(String::as_str))
            .collect();
        let (models, current) = tokio::time::timeout(
            Duration::from_secs(15),
            models(&argv, &Host::Local, "Local"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(current.as_deref(), Some("default"));
        assert_eq!(
            models
                .iter()
                .map(|m| (m.id.as_str(), m.name.as_str(), m.description.as_deref()))
                .collect::<Vec<_>>(),
            [
                ("default", "Default", Some("Balanced")),
                ("test-model", "Test", None)
            ]
        );
    }

    #[tokio::test]
    async fn a_missing_acp_executable_is_named_instead_of_a_closed_transport() {
        let mut config = config("report");
        config.command = "totex-no-such-acp-agent".into();
        let error = observed(&config, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap_err();
        assert_eq!(error, "totex-no-such-acp-agent is not installed on Local");
    }

    #[tokio::test]
    async fn observer_permissions_are_cancelled_and_reported_immediately() {
        let error = tokio::time::timeout(
            Duration::from_secs(5),
            observed(&config("permission"), Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert!(error.starts_with("Permission required:"), "{error}");
    }

    #[tokio::test]
    async fn cancellation_terminates_observer_process() {
        let marker =
            std::env::temp_dir().join(format!("totex-monitor-cancel-{}.pid", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let mut config = config("stall");
        config.args.push(marker.to_string_lossy().into_owned());
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = cancelled.clone();
        let marker_wait = marker.clone();
        let stop = async move {
            for _ in 0..100 {
                if marker_wait.exists() {
                    signal.store(true, Ordering::Release);
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            panic!("fake observer did not start");
        };
        let (result, ()) = tokio::join!(observed(&config, cancelled), stop);
        assert_eq!(result.unwrap_err(), "Monitor cancelled");
        let marker_data: Value =
            serde_json::from_str(&std::fs::read_to_string(&marker).unwrap()).unwrap();
        let pid = marker_data["pid"].as_i64().unwrap() as i32;
        assert!(
            !std::path::Path::new(marker_data["cwd"].as_str().unwrap()).exists(),
            "observation workspace survived cancellation"
        );
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_ne!(
            unsafe { libc::kill(pid, 0) },
            0,
            "observer survived cancellation"
        );
        let _ = std::fs::remove_file(marker);
    }
}
