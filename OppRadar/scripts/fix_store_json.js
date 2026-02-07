
import fs from 'fs';
import path from 'path';

const storePath = 'E:/OppRadar/data/runtime/store.json';

try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    console.log('Original scans count:', data.scans.length);
    
    data.scans = data.scans.filter(s => s !== null && s !== undefined);
    console.log('Cleaned scans count:', data.scans.length);
    
    if (data.opps) {
        console.log('Original opps count:', data.opps.length);
        data.opps = data.opps.filter(o => o !== null && o !== undefined);
        console.log('Cleaned opps count:', data.opps.length);
    }

    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
    console.log('Fixed store.json');
} catch (e) {
    console.error('Error fixing store.json:', e);
}
