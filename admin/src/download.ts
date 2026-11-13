/**
 * Lets the browser download a file
 *
 * @param fileName Name of the downloaded file
 * @param url URL of the content, e.g. an object URL or a data URL
 */
export function downloadUrl(fileName: string, url: string): void {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/**
 * Lets the browser download data as JSON file
 *
 * @param fileName Name of the downloaded file
 * @param data Written as JSON
 */
export function downloadJson(fileName: string, data: any): void {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    downloadUrl(fileName, url);
    // the browser has started the download when the click is handled
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
