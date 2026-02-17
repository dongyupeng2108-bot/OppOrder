const fs = require('fs');

console.log("Starting interactive test...");
console.log("Please provide value for confirmation:"); // Trigger string

try {
    const fd = process.stdin.fd;
    const buffer = Buffer.alloc(10);
    const bytesRead = fs.readSync(fd, buffer, 0, 10, null);
    console.log("Bytes read:", bytesRead);
    if (bytesRead === 0) {
        console.error("Read EOF (simulating interactive failure)");
        process.exit(1);
    }
} catch (e) {
    console.error("Read failed (expected):", e.message);
    process.exit(1);
}
