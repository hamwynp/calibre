//! Google Calendar access (REST API v3).
//!
//! Login: for now calibre reuses the login that `gcalcli` already has. On first use the
//! OAuth client + refresh token are copied from gcalcli's saved login into calibre's own
//! data dir (`google-token.json`, owner-only). After that only calibre's copy is used and
//! access tokens are refreshed here. (A built-in sign-in flow will replace the import.)

use futures::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const API: &str = "https://www.googleapis.com/calendar/v3/";

pub struct GoogleState {
    client: reqwest::Client,
    access: tokio::sync::Mutex<Option<(String, Instant)>>,
}

impl GoogleState {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(25))
                .build()
                .expect("http client"),
            access: tokio::sync::Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct StoredToken {
    client_id: String,
    client_secret: String,
    refresh_token: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".into()
}

fn friendly(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() || e.is_request() {
        "Can't reach Google - is the VPN on?".into()
    } else {
        e.to_string()
    }
}

fn token_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("google-token.json"))
}

const IMPORT_SCRIPT: &str = r#"
import pickle, os, json
c = pickle.load(open(os.path.expanduser("~/.local/share/gcalcli/oauth"), "rb"))
print(json.dumps({"client_id": c.client_id, "client_secret": c.client_secret,
                  "refresh_token": c.refresh_token, "token_uri": c.token_uri}))
"#;

/// Copy the login from gcalcli (one time).
fn import_from_gcalcli() -> Result<StoredToken, String> {
    let out = std::process::Command::new("python3")
        .args(["-I", "-c", IMPORT_SCRIPT])
        .output()
        .map_err(|_| "Not logged in to Google (python3 not found to import the gcalcli login)".to_string())?;
    if !out.status.success() {
        return Err("Not logged in to Google - run: gcalcli init".into());
    }
    serde_json::from_slice(&out.stdout).map_err(|_| "Not logged in to Google - run: gcalcli init".to_string())
}

fn load_token(app: &AppHandle) -> Result<StoredToken, String> {
    let path = token_path(app)?;
    if let Ok(txt) = std::fs::read_to_string(&path) {
        if let Ok(t) = serde_json::from_str::<StoredToken>(&txt) {
            return Ok(t);
        }
    }
    let tok = import_from_gcalcli()?;
    std::fs::write(&path, serde_json::to_string(&tok).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(tok)
}

async fn access_token(app: &AppHandle, st: &GoogleState) -> Result<String, String> {
    let mut guard = st.access.lock().await;
    if let Some((t, exp)) = guard.as_ref() {
        if Instant::now() < *exp {
            return Ok(t.clone());
        }
    }
    let tok = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || load_token(&app))
            .await
            .map_err(|e| e.to_string())??
    };
    let resp = st
        .client
        .post(&tok.token_uri)
        .form(&[
            ("client_id", tok.client_id.as_str()),
            ("client_secret", tok.client_secret.as_str()),
            ("refresh_token", tok.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(friendly)?;
    let ok = resp.status().is_success();
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(if body["error"] == "invalid_grant" {
            "Google login expired - run: gcalcli init".into()
        } else {
            format!("Google sign-in failed: {}", body["error_description"].as_str().unwrap_or("unknown error"))
        });
    }
    let access = body["access_token"].as_str().ok_or("no access token in response")?.to_string();
    let ttl = body["expires_in"].as_u64().unwrap_or(3000).saturating_sub(60);
    *guard = Some((access.clone(), Instant::now() + Duration::from_secs(ttl)));
    Ok(access)
}

async fn api_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    format!("Google API {}: {}", status.as_u16(), body["error"]["message"].as_str().unwrap_or("request failed"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDto {
    id: String,
    name: String,
    color: String,
    writable: bool,
    primary: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EventDto {
    id: String,
    title: String,
    calendar_id: String,
    /// RFC 3339 date-time, or `YYYY-MM-DD` for all-day events.
    start: String,
    end: String,
    all_day: bool,
    recurring: bool,
}

#[tauri::command]
pub async fn google_calendars(app: AppHandle, st: State<'_, GoogleState>) -> Result<Vec<CalendarDto>, String> {
    let token = access_token(&app, &st).await?;
    let resp = st
        .client
        .get(format!("{API}users/me/calendarList"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(friendly)?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = vec![];
    for c in body["items"].as_array().cloned().unwrap_or_default() {
        if c["hidden"] == true || c["selected"] == false {
            continue;
        }
        let role = c["accessRole"].as_str().unwrap_or("reader");
        out.push(CalendarDto {
            id: c["id"].as_str().unwrap_or_default().to_string(),
            name: c["summaryOverride"].as_str().or(c["summary"].as_str()).unwrap_or("Calendar").to_string(),
            color: c["backgroundColor"].as_str().unwrap_or("#8b93a7").to_string(),
            writable: role == "owner" || role == "writer",
            primary: c["primary"] == true,
        });
    }
    Ok(out)
}

fn map_event(e: &Value, calendar_id: &str) -> Option<EventDto> {
    if e["status"] == "cancelled" {
        return None;
    }
    let (start, all_day) = match e["start"]["dateTime"].as_str() {
        Some(s) => (s.to_string(), false),
        None => (e["start"]["date"].as_str()?.to_string(), true),
    };
    let end = e["end"]["dateTime"].as_str().or(e["end"]["date"].as_str())?.to_string();
    Some(EventDto {
        id: e["id"].as_str()?.to_string(),
        title: e["summary"].as_str().unwrap_or("(no title)").to_string(),
        calendar_id: calendar_id.to_string(),
        start,
        end,
        all_day,
        recurring: e.get("recurringEventId").is_some(),
    })
}

async fn calendar_events(
    st: &GoogleState,
    token: &str,
    calendar_id: &str,
    time_min: &str,
    time_max: &str,
) -> Result<Vec<EventDto>, String> {
    let mut url = reqwest::Url::parse(&format!("{API}calendars/")).map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "bad url".to_string())?
        .pop_if_empty()
        .push(calendar_id)
        .push("events");
    let mut out = vec![];
    let mut page: Option<String> = None;
    loop {
        let mut q: Vec<(&str, String)> = vec![
            ("timeMin", time_min.into()),
            ("timeMax", time_max.into()),
            ("singleEvents", "true".into()),
            ("orderBy", "startTime".into()),
            ("maxResults", "2500".into()),
        ];
        if let Some(p) = &page {
            q.push(("pageToken", p.clone()));
        }
        let resp = st.client.get(url.clone()).query(&q).bearer_auth(token).send().await.map_err(friendly)?;
        if !resp.status().is_success() {
            return Err(api_error(resp).await);
        }
        let body: Value = resp.json().await.map_err(|e| e.to_string())?;
        for e in body["items"].as_array().cloned().unwrap_or_default() {
            if let Some(ev) = map_event(&e, calendar_id) {
                out.push(ev);
            }
        }
        match body["nextPageToken"].as_str() {
            Some(p) => page = Some(p.to_string()),
            None => break,
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn google_events(
    app: AppHandle,
    st: State<'_, GoogleState>,
    time_min: String,
    time_max: String,
    calendar_ids: Vec<String>,
) -> Result<Vec<EventDto>, String> {
    let token = access_token(&app, &st).await?;
    let results = join_all(calendar_ids.iter().map(|id| calendar_events(&st, &token, id, &time_min, &time_max))).await;
    let mut events = vec![];
    let mut first_err = None;
    let mut any_ok = false;
    for r in results {
        match r {
            Ok(mut v) => {
                any_ok = true;
                events.append(&mut v);
            }
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    match (any_ok || calendar_ids.is_empty(), first_err) {
        (true, _) => Ok(events),
        (false, Some(e)) => Err(e),
        (false, None) => Ok(events),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEventArgs {
    calendar_id: String,
    title: String,
    all_day: bool,
    /// `YYYY-MM-DD` (all-day) or local `YYYY-MM-DDTHH:MM:SS` (timed).
    start: String,
    end: String,
    time_zone: String,
    /// e.g. `RRULE:FREQ=WEEKLY;COUNT=10`
    recurrence: Option<String>,
}

#[tauri::command]
pub async fn google_create(app: AppHandle, st: State<'_, GoogleState>, args: NewEventArgs) -> Result<EventDto, String> {
    let token = access_token(&app, &st).await?;
    let mut body = if args.all_day {
        json!({ "summary": args.title, "start": { "date": args.start }, "end": { "date": args.end } })
    } else {
        json!({
            "summary": args.title,
            "start": { "dateTime": args.start, "timeZone": args.time_zone },
            "end": { "dateTime": args.end, "timeZone": args.time_zone },
        })
    };
    if let Some(r) = args.recurrence.filter(|r| !r.is_empty()) {
        body["recurrence"] = json!([r]);
    }
    let mut url = reqwest::Url::parse(&format!("{API}calendars/")).map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "bad url".to_string())?
        .pop_if_empty()
        .push(&args.calendar_id)
        .push("events");
    let resp = st.client.post(url).bearer_auth(&token).json(&body).send().await.map_err(friendly)?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    let created: Value = resp.json().await.map_err(|e| e.to_string())?;
    map_event(&created, &args.calendar_id).ok_or_else(|| "unexpected response from Google".to_string())
}
