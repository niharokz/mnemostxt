use std::collections::HashMap;

/// Counts how often each word appears.
fn count(text: &str) -> HashMap<String, usize> {
    let mut out = HashMap::new();
    for w in text.split_whitespace() {
        *out.entry(w.to_lowercase()).or_insert(0) += 1;
    }
    out
}

fn main() {
    let c = count("the notes the folder");
    println!("{:?}", c.get("the")); // Some(2)
}
