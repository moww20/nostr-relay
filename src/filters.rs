use serde::{Deserialize, Serialize};
use crate::events::Event;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub subscription_id: String,
    pub filters: Vec<Filter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub subscription_id: String,
}

impl Filter {
    pub fn new() -> Self {
        Self {
            ids: None,
            authors: None,
            kinds: None,
            since: None,
            until: None,
            limit: None,
            tags: None,
        }
    }

    pub fn matches(&self, event: &Event) -> bool {
        // Check IDs
        if let Some(ids) = &self.ids {
            if !ids.contains(&event.id) {
                return false;
            }
        }

        // Check authors
        if let Some(authors) = &self.authors {
            if !authors.contains(&event.pubkey) {
                return false;
            }
        }

        // Check kinds
        if let Some(kinds) = &self.kinds {
            if !kinds.contains(&event.kind) {
                return false;
            }
        }

        // Check since timestamp
        if let Some(since) = self.since {
            if event.created_at < since {
                return false;
            }
        }

        // Check until timestamp
        if let Some(until) = self.until {
            if event.created_at > until {
                return false;
            }
        }

        // Check tags
        if let Some(filter_tags) = &self.tags {
            for filter_tag in filter_tags {
                if filter_tag.len() < 2 {
                    continue;
                }
                let tag_name = &filter_tag[0];
                let tag_values = &filter_tag[1..];
                
                let mut tag_found = false;
                for event_tag in &event.tags {
                    if event_tag.len() >= 2 && event_tag[0] == *tag_name {
                        for tag_value in tag_values {
                            if event_tag.iter().skip(1).any(|v| v == tag_value) {
                                tag_found = true;
                                break;
                            }
                        }
                        if tag_found {
                            break;
                        }
                    }
                }
                
                if !tag_found {
                    return false;
                }
            }
        }

        true
    }

    pub fn get_limit(&self) -> usize {
        self.limit.unwrap_or(100)
    }
}

impl RequestMessage {
    pub fn new(subscription_id: String, filters: Vec<Filter>) -> Self {
        Self {
            message_type: "REQ".to_string(),
            subscription_id,
            filters,
        }
    }
}

impl CloseMessage {
    pub fn new(subscription_id: String) -> Self {
        Self {
            message_type: "CLOSE".to_string(),
            subscription_id,
        }
    }
}
