// Opening a file we have to fetch a signed URL for first.
//
// The obvious way, await the URL and then call window.open, is blocked by Safari and by iPad:
// by the time the promise resolves the click that authorised it is over, and the browser
// refuses silently, with no exception to catch and nothing on screen. So the tab is opened
// straight away while the gesture still counts, and the URL is put into it when it arrives.
// If the browser refused the empty tab too, the caller gets a message it can show.
export async function openSignedUrl(fetchUrl: () => Promise<string>): Promise<void> {
  const tab = window.open("", "_blank", "noopener");
  try {
    const url = await fetchUrl();
    if (!tab) {
      throw new Error("Your browser blocked the download tab. Allow pop-ups for this site and try again.");
    }
    tab.location.replace(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
