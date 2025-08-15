import json

# Load the JSON
with open("channel_export.json", "r", encoding="utf-8") as f:
    data = json.load(f)

filtered_messages = []
for msg in data["messages"]:
    # Always clear the roles array (if you still want it present)
    msg["author"]["roles"] = []

    # Keep only messages containing at least one @
    if msg.get("content") and "@" in msg["content"]:
        filtered_messages.append({
            "author": msg["author"]["name"],
            "timestamp": msg["timestamp"],
            "content": msg["content"].strip()
        })

# Replace with filtered messages
data["messages"] = filtered_messages

# Save the cleaned output
with open("output.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Saved {len(filtered_messages)} filtered messages to output.json")
