# Length-Object-Binary (LOB) Packet Encoding (javascript)

This module will encode and decode [LOB](https://github.com/telehash/telehash.org/tree/v3/v3/lob) packets to/from JSON and Buffers.

Install: `npm install lob-enc`

Primary usage:

```js
var lob = require('lob-enc');
var json = {
  "type":"test",
  "foo":["bar"]
};
var body = new Buffer("any binary!");
var bin = lob.encode(json, body));
// bin will be a buffer with json and body encoded

var packet = lob.decode(bin);
// packet.json == json, and packet.body == body

// do both encode and decode together, for convenience
var packet = lob.packet(json, body);

// object validator
var bool = lob.isPacket(packet);
```
