import requests
from bs4 import BeautifulSoup
import os
import time
import html2text

BASE_URL = "https://my-island-solstice.fandom.com"
API_URL = f"{BASE_URL}/api.php"
OUTPUT_MD = "my_island_solstice_wiki.md"
IMAGES_DIR = "wiki_images"

os.makedirs(IMAGES_DIR, exist_ok=True)

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; WikiScraper/1.0; +https://example.com)"
})

def get_all_page_titles():
    """Retrieve all page titles using the MediaWiki API."""
    titles = []
    apcontinue = None

    while True:
        params = {
            "action": "query",
            "list": "allpages",
            "aplimit": "500",
            "format": "json"
        }
        if apcontinue:
            params["apcontinue"] = apcontinue

        resp = session.get(API_URL, params=params)
        data = resp.json()

        for page in data["query"]["allpages"]:
            titles.append(page["title"])

        if "continue" in data:
            apcontinue = data["continue"]["apcontinue"]
        else:
            break

        time.sleep(0.5)

    return titles

def download_images_from_html(soup):
    """Download images and update their src in HTML to local paths."""
    for img in soup.find_all("img"):
        src = img.get("src")
        if not src:
            continue
        filename = os.path.basename(src.split("?")[0])
        filepath = os.path.join(IMAGES_DIR, filename)

        # Download image if not already
        if not os.path.exists(filepath):
            try:
                img_data = session.get(src).content
                with open(filepath, "wb") as f:
                    f.write(img_data)
                time.sleep(0.2)
            except Exception as e:
                print(f"Failed to download {src}: {e}")

        img["src"] = f"{IMAGES_DIR}/{filename}"

def get_page_html(title):
    """Fetch the HTML of a wiki page without Fandom layout."""
    params = {
        "action": "parse",
        "page": title,
        "format": "json",
        "prop": "text"
    }
    resp = session.get(API_URL, params=params)
    data = resp.json()

    html_content = data["parse"]["text"]["*"]
    soup = BeautifulSoup(html_content, "html.parser")

    # Clean unwanted tags
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()

    # Download images and update src
    download_images_from_html(soup)

    return str(soup)

def main():
    titles = get_all_page_titles()
    print(f"Found {len(titles)} pages.")

    converter = html2text.HTML2Text()
    converter.ignore_links = False
    converter.ignore_images = False

    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        for title in titles:
            print(f"Processing: {title}")
            html_content = get_page_html(title)
            markdown = converter.handle(html_content)
            f.write(f"# {title}\n\n{markdown}\n\n{'='*80}\n\n")
            time.sleep(0.5)

    print(f"Saved wiki as Markdown to {OUTPUT_MD}")
    print(f"Images saved to {IMAGES_DIR}/")

if __name__ == "__main__":
    main()

