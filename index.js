// encode a packet
exports.encode = function(head, body)
{
  // support different arg types
  if(head === null) head = false; // grrrr
  if(typeof head == 'number') head = new Buffer(String.fromCharCode(json));
  if(typeof head == 'object')
  {
    // accept a packet as the first arg
    if(Buffer.isBuffer(head.body) && body === undefined)
    {
      body = head.body;
      head = head.head || head.json;
    }
    // serialize raw json
    if(!Buffer.isBuffer(head))
    {
      head = new Buffer(JSON.stringify(head));
      // require real json object
      if(head.length < 7) head = false;
    }
  }
  head = head || new Buffer(0);
  if(typeof body == 'string') body = new Buffer(body, 'binary');
  body = body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(head.length, 0);
  return Buffer.concat([len, head, body]);
}

// packet decoding, add values to a buffer return
exports.decode =function(bin)
{
  if(!bin) return undefined;
  var buf = (typeof bin == 'string') ? new Buffer(bin, 'binary') : bin;
  if(bin.length < 2) return undefined;

  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len > (buf.length - 2)) return undefined;
  buf.head = buf.slice(2, len+2);
  buf.body = buf.slice(len + 2);

  // parse out the json
  buf.json = {};
  if(len >= 7)
  {
    try {
      buf.json = JSON.parse(buf.head.toString('utf8'));
    } catch(E) {
      return undefined;
    }
  }
  return buf;
}

// convenience to create a valid packet object
exports.packet = function(head, body)
{
  return exports.decode(exports.encode(head, body));
}

exports.isPacket = function(packet)
{
  if(!Buffer.isBuffer(packet)) return false;
  if(packet.length < 2) return false;
  if(typeof packet.json != 'object') return false;
  if(!Buffer.isBuffer(packet.head)) return false;
  if(!Buffer.isBuffer(packet.body)) return false;
  return true;
}

// read a bytestream for a packet, decode the header and pass body through
var Transform = require('stream').Transform;
exports.stream = function(cbHead){
  var stream = new Transform();
  var buf = new Buffer(0);
  stream._transform = function(data,enc,cbTransform)
  {
    // no buffer means pass everything through
    if(!buf)
    {
      stream.push(data);
      return cbTransform();
    }
    // gather until full header
    buf = Buffer.concat([buf,data]);
    var packet = exports.decode(buf);
    if(!packet) return cbTransform();
    buf = false; // pass through all future data
    // give to the app
    cbHead(packet, function(err){
      if(err) return cbTransform(err);
      stream.push(packet.body);
      cbTransform();
    });
  }
  return stream;
}
