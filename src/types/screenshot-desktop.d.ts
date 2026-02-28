declare module 'screenshot-desktop' {
    interface ScreenshotOptions {
        filename?: string;
        format?: string;
        screen?: string | number;
    }
    function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    export = screenshot;
}
