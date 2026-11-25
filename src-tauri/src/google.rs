//! Google Calendar access (REST API v3) with a built-in sign-in.
//!
//! Sign-in is OAuth 2.0 for installed apps: the system browser opens Google's consent page,
//! Google redirects to a temporary `http://127.0.0.1:<port>` listener, and the code is exchanged
//! (with PKCE) for a refresh token that is stored owner-only in `google-token.json` in the app
//! data dir. Access tokens are refreshed here as needed.
//!
//! The OAuth *client* (id + secret) comes from, in order: `google-client.json` in the app data
//! dir, a client embedded at build time (`CALIBRE_GOOGLE_CLIENT_ID` / `_SECRET`), or the client of
//! an existing sign-in. See docs/GOOGLE_SETUP.md.

use futures::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

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

/// Prefix on errors that mean "the user has to sign in (again)"; the UI shows the sign-in card.
const SIGN_IN: &str = "SIGN_IN: ";

fn write_private(path: &std::path::Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn client_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("google-client.json"))
}

#[derive(Serialize, Deserialize, Clone)]
struct ClientConfig {
    client_id: String,
    client_secret: String,
}

/// Where the OAuth client comes from (see the module docs).
fn client_config(app: &AppHandle) -> Result<ClientConfig, String> {
    if let Ok(txt) = std::fs::read_to_string(client_path(app)?) {
        if let Ok(c) = serde_json::from_str::<ClientConfig>(&txt) {
            return Ok(c);
        }
    }
    if let (Some(id), Some(secret)) = (option_env!("CALIBRE_GOOGLE_CLIENT_ID"), option_env!("CALIBRE_GOOGLE_CLIENT_SECRET")) {
        return Ok(ClientConfig { client_id: id.into(), client_secret: secret.into() });
    }
    if let Ok(t) = read_token(app) {
        return Ok(ClientConfig { client_id: t.client_id, client_secret: t.client_secret });
    }
    Err("No Google client configured. Create an OAuth client and put it in google-client.json (see docs/GOOGLE_SETUP.md).".into())
}

/// Remember the client so signing out and back in keeps working.
fn remember_client(app: &AppHandle, c: &ClientConfig) {
    if let Ok(p) = client_path(app) {
        if !p.exists() {
            if let Ok(txt) = serde_json::to_string(c) {
                let _ = write_private(&p, &txt);
            }
        }
    }
}

fn read_token(app: &AppHandle) -> Result<StoredToken, String> {
    let txt = std::fs::read_to_string(token_path(app)?).map_err(|_| format!("{SIGN_IN}Not signed in to Google"))?;
    serde_json::from_str::<StoredToken>(&txt).map_err(|_| format!("{SIGN_IN}Not signed in to Google"))
}

async fn access_token(app: &AppHandle, st: &GoogleState) -> Result<String, String> {
    let mut guard = st.access.lock().await;
    if let Some((t, exp)) = guard.as_ref() {
        if Instant::now() < *exp {
            return Ok(t.clone());
        }
    }
    let tok = read_token(app)?;
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
            format!("{SIGN_IN}Google sign-in expired - please sign in again")
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
    /// For an occurrence of a repeating event: the id of the whole series.
    recurring_event_id: Option<String>,
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
        recurring_event_id: e["recurringEventId"].as_str().map(str::to_string),
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

fn event_url(calendar_id: &str, event_id: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(&format!("{API}calendars/")).map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "bad url".to_string())?
        .pop_if_empty()
        .push(calendar_id)
        .push("events")
        .push(event_id);
    Ok(url)
}

async fn fetch_event(st: &GoogleState, token: &str, calendar_id: &str, event_id: &str) -> Result<Value, String> {
    let resp = st.client.get(event_url(calendar_id, event_id)?).bearer_auth(token).send().await.map_err(friendly)?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// (start, end, all_day) of an event; start/end are RFC 3339 or `YYYY-MM-DD`.
fn times_of(e: &Value) -> Option<(String, String, bool)> {
    let (start, all_day) = match e["start"]["dateTime"].as_str() {
        Some(s) => (s.to_string(), false),
        None => (e["start"]["date"].as_str()?.to_string(), true),
    };
    let end = e["end"]["dateTime"].as_str().or(e["end"]["date"].as_str())?.to_string();
    Some((start, end, all_day))
}

/// The first `RRULE:` line of an event, if it has one.
fn rule_of(e: &Value) -> Option<String> {
    e["recurrence"].as_array()?.iter().filter_map(|r| r.as_str()).find(|r| r.starts_with("RRULE:")).map(str::to_string)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDto {
    id: String,
    start: String,
    end: String,
    all_day: bool,
    recurrence: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailDto {
    start: String,
    end: String,
    all_day: bool,
    /// Set when this event is an occurrence of a repeating event: the whole series.
    series: Option<SeriesDto>,
}

/// What the edit form needs: this event's times and, for repeating events, the series.
#[tauri::command]
pub async fn google_event_detail(app: AppHandle, st: State<'_, GoogleState>, calendar_id: String, event_id: String) -> Result<DetailDto, String> {
    let token = access_token(&app, &st).await?;
    let e = fetch_event(&st, &token, &calendar_id, &event_id).await?;
    let (start, end, all_day) = times_of(&e).ok_or_else(|| "unexpected response from Google".to_string())?;
    let series = match e["recurringEventId"].as_str() {
        Some(sid) => {
            let m = fetch_event(&st, &token, &calendar_id, sid).await?;
            let (s, en, ad) = times_of(&m).ok_or_else(|| "unexpected response from Google".to_string())?;
            Some(SeriesDto { id: sid.to_string(), start: s, end: en, all_day: ad, recurrence: rule_of(&m) })
        }
        None => None,
    };
    Ok(DetailDto { start, end, all_day, series })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEventArgs {
    calendar_id: String,
    /// The event to change: an occurrence's id, or a series' id to change every occurrence.
    event_id: String,
    title: String,
    all_day: bool,
    /// `YYYY-MM-DD` (all-day) or local `YYYY-MM-DDTHH:MM:SS` (timed).
    start: String,
    end: String,
    time_zone: String,
    /// When false the repeat rule is left alone.
    set_recurrence: bool,
    /// New rule, e.g. `RRULE:FREQ=WEEKLY`; empty/None with `set_recurrence` stops it repeating.
    recurrence: Option<String>,
}

#[tauri::command]
pub async fn google_update(app: AppHandle, st: State<'_, GoogleState>, args: UpdateEventArgs) -> Result<(), String> {
    let token = access_token(&app, &st).await?;
    // The other of date / dateTime is nulled so an all-day event can become timed and back.
    let mut body = if args.all_day {
        json!({
            "summary": args.title,
            "start": { "date": args.start, "dateTime": null, "timeZone": null },
            "end": { "date": args.end, "dateTime": null, "timeZone": null },
        })
    } else {
        json!({
            "summary": args.title,
            "start": { "dateTime": args.start, "timeZone": args.time_zone, "date": null },
            "end": { "dateTime": args.end, "timeZone": args.time_zone, "date": null },
        })
    };
    if args.set_recurrence {
        body["recurrence"] = match args.recurrence.filter(|r| !r.is_empty()) {
            Some(r) => json!([r]),
            None => Value::Null,
        };
    }
    let resp = st
        .client
        .patch(event_url(&args.calendar_id, &args.event_id)?)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(friendly)?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    Ok(())
}

/// Move an event (or a whole series, by its series id) to another calendar. Its id stays the same.
#[tauri::command]
pub async fn google_move(app: AppHandle, st: State<'_, GoogleState>, calendar_id: String, event_id: String, destination: String) -> Result<(), String> {
    let token = access_token(&app, &st).await?;
    let mut url = event_url(&calendar_id, &event_id)?;
    url.path_segments_mut().map_err(|_| "bad url".to_string())?.push("move");
    let resp = st
        .client
        .post(url)
        .query(&[("destination", destination.as_str())])
        .bearer_auth(&token)
        .send()
        .await
        .map_err(friendly)?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    Ok(())
}

/// Delete an event, or a whole series when given the series id. Already gone (410) counts as done.
#[tauri::command]
pub async fn google_delete(app: AppHandle, st: State<'_, GoogleState>, calendar_id: String, event_id: String) -> Result<(), String> {
    let token = access_token(&app, &st).await?;
    let resp = st.client.delete(event_url(&calendar_id, &event_id)?).bearer_auth(&token).send().await.map_err(friendly)?;
    if !resp.status().is_success() && resp.status().as_u16() != 410 {
        return Err(api_error(resp).await);
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Sign-in (OAuth 2.0 for installed apps: loopback redirect + PKCE)
// ---------------------------------------------------------------------------------------------

/// Is there a saved sign-in? (No network.)
#[tauri::command]
pub fn google_signed_in(app: AppHandle) -> bool {
    read_token(&app).is_ok()
}

fn random_string(n: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(n).map(char::from).collect()
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>calibre</title>\
<body style=\"font:16px system-ui;background:#11131a;color:#e8ebf3;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h2 style=\"margin:0 0 8px\">You're signed in</h2>\
<p style=\"color:#8b93a7;margin:0\">You can close this tab and go back to calibre.</p></div>";

/// Wait for Google's redirect on `listener`; returns the authorization code.
fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() > deadline {
            return Err("Sign-in timed out - please try again".into());
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        stream.set_nonblocking(false).ok();
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
        let url = match reqwest::Url::parse(&format!("http://127.0.0.1{path}")) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let params: std::collections::HashMap<String, String> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        let respond = |stream: &mut std::net::TcpStream, body: &str| {
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
        };
        // browsers also poke /favicon.ico and open idle connections: ignore anything without a result
        if let Some(err) = params.get("error") {
            respond(&mut stream, "<!doctype html><meta charset=utf-8><body style=\"font:16px system-ui\">Sign-in was cancelled. You can close this tab.");
            return Err(if err == "access_denied" { "Sign-in was cancelled".into() } else { format!("Google sign-in failed: {err}") });
        }
        if let Some(code) = params.get("code") {
            if params.get("state").map(String::as_str) != Some(expected_state) {
                respond(&mut stream, "<!doctype html><body>Invalid sign-in response.");
                return Err("Sign-in response did not match the request - please try again".into());
            }
            respond(&mut stream, DONE_PAGE);
            return Ok(code.clone());
        }
        respond(&mut stream, "<!doctype html><body>calibre is waiting for Google...");
    }
}

#[tauri::command]
pub async fn google_sign_in(app: AppHandle, st: State<'_, GoogleState>) -> Result<(), String> {
    let client = client_config(&app)?;

    // PKCE + CSRF state
    let verifier = random_string(64);
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Couldn't start the sign-in listener: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let auth_url = reqwest::Url::parse_with_params(
        "https://accounts.google.com/o/oauth2/v2/auth",
        &[
            ("client_id", client.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", "https://www.googleapis.com/auth/calendar"),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;

    app.opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("Couldn't open your browser ({e}). Open this link yourself: {auth_url}"))?;

    let expected = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &expected))
        .await
        .map_err(|e| e.to_string())??;

    let resp = st
        .client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(friendly)?;
    let ok = resp.status().is_success();
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(format!("Google sign-in failed: {}", body["error_description"].as_str().unwrap_or("token exchange failed")));
    }
    let refresh = body["refresh_token"].as_str().ok_or("Google didn't return a refresh token - please try again")?.to_string();
    let access = body["access_token"].as_str().ok_or("no access token in response")?.to_string();
    let ttl = body["expires_in"].as_u64().unwrap_or(3000).saturating_sub(60);

    let tok = StoredToken {
        client_id: client.client_id.clone(),
        client_secret: client.client_secret.clone(),
        refresh_token: refresh,
        token_uri: default_token_uri(),
    };
    write_private(&token_path(&app)?, &serde_json::to_string(&tok).map_err(|e| e.to_string())?)?;
    remember_client(&app, &client);
    *st.access.lock().await = Some((access, Instant::now() + Duration::from_secs(ttl)));
    Ok(())
}

#[tauri::command]
pub async fn google_sign_out(app: AppHandle, st: State<'_, GoogleState>) -> Result<(), String> {
    if let Ok(tok) = read_token(&app) {
        remember_client(&app, &ClientConfig { client_id: tok.client_id.clone(), client_secret: tok.client_secret.clone() });
        // best effort: tell Google to forget this grant
        let _ = st.client.post("https://oauth2.googleapis.com/revoke").form(&[("token", tok.refresh_token.as_str())]).send().await;
    }
    let _ = std::fs::remove_file(token_path(&app)?);
    *st.access.lock().await = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;

    /// Send one raw HTTP request to `port`, return the response text.
    fn request(port: u16, line: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "{line}\r\nHost: x\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    fn run(requests: Vec<&'static str>, state: &'static str) -> (Result<String, String>, Vec<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = std::thread::spawn(move || wait_for_code(listener, state));
        let replies: Vec<String> = requests.into_iter().map(|r| request(port, r)).collect();
        (waiter.join().unwrap(), replies)
    }

    #[test]
    fn returns_the_code_and_ignores_favicon_requests() {
        let (res, replies) = run(vec!["GET /favicon.ico HTTP/1.1", "GET /?code=abc123&state=xyz HTTP/1.1"], "xyz");
        assert_eq!(res.unwrap(), "abc123");
        assert!(replies[1].contains("You're signed in"));
    }

    #[test]
    fn rejects_a_mismatched_state() {
        let (res, _) = run(vec!["GET /?code=abc&state=evil HTTP/1.1"], "xyz");
        assert!(res.unwrap_err().contains("did not match"));
    }

    #[test]
    fn reports_a_cancelled_sign_in() {
        let (res, _) = run(vec!["GET /?error=access_denied&state=xyz HTTP/1.1"], "xyz");
        assert_eq!(res.unwrap_err(), "Sign-in was cancelled");
    }

    #[test]
    fn pkce_challenge_matches_the_rfc_example() {
        // RFC 7636 appendix B
        let c = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
        assert_eq!(c, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
