var crypto = require('crypto');
var chacha20 = require('chacha20');

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

// chunking stream
var Duplex = require('stream').Duplex;
exports.chunking = function(args, cbPacket){
  if(!args) args = {};
  if(!cbPacket) cbPacket = function(err, packet){ };

  // chunks can have space for 1 to 255 bytes
  if(!args.size || args.size > 256) args.size = 256;
  var space = args.size - 1;
  if(space < 1) space = 1; // minimum
  
  var blocked = false;
  if(args.blocking) args.ack = true; // blocking requires acks

  var stream = new Duplex({allowHalfOpen:false});
  var queue = [];
  
  // incoming chunked data coming from another stream
  var chunks = new Buffer(0);
  var data = new Buffer(0);
  stream._write = function(data2,enc,cbWrite)
  {
    // trigger an error when http is detected, but otherwise continue
    if(data.length == 0 && data2.slice(0,5).toString() == 'GET /')
    {
      cbPacket("HTTP detected",data2);
    }
    data = Buffer.concat([data,data2]);
    while(data.length)
    {
      var len = data.readUInt8(0);
      // packet done or ack
      if(len === 0)
      {
        blocked = false;
        if(chunks.length)
        {
          var packet = exports.decode(chunks);
          chunks = new Buffer(0);
          if(packet) cbPacket(false, packet);
        }
        data = data.slice(1);
        continue;
      }
      // not a full chunk yet, wait for more
      if(data.length < (len+1)) break;

      // full chunk, buffer it up
      blocked = false;
      chunks = Buffer.concat([chunks,data.slice(1,len+1)]);
      data = data.slice(len+1);
      // ensure a response when enabled
      if(args.ack)
      {
        if(!queue.length) queue.push(new Buffer("\0"));
      }
    }
    stream.send(); // always try sending more data
    cbWrite();
  }

  // accept packets to be chunked
  stream.send = function(packet)
  {
    // break packet into chunks and add to queue
    while(packet)
    {
      var len = new Buffer(1);
      var chunk = packet.slice(0,space);
      packet = packet.slice(chunk.length);
      len.writeUInt8(chunk.length,0);
      // check if we can include the packet terminating zero
      var zero = new Buffer(0);
      if(packet.length == 0 && chunk.length <= space)
      {
        zero = new Buffer("\0");
        packet = false;
      }
      queue.push(Buffer.concat([len,chunk,zero]));
    }

    // pull next chunk off the queue
    if(queue.length && !blocked)
    {
      var chunk = queue.shift();
      if(args.blocking && chunk.length > 1) blocked = true;
      if(stream.push(chunk)) stream.send(); // let the loop figure itself out
    }
  }

  // try sending more chunks
  stream._read = function(size)
  {
    stream.send();
  }

  return stream;
}

function keyize(key)
{
  if(!key) key = "telehash";
  if(Buffer.isBuffer(key) && key.length == 32) return key;
  return crypto.createHash('sha256').update(key).digest();
}

exports.cloak = function(packet, key, rounds)
{
  if(!(key = keyize(key)) || !Buffer.isBuffer(packet)) return undefined;
  if(!rounds) rounds = 1;
  // get a non-zero start
  while(1)
  {
    var nonce = crypto.randomBytes(8);
    if(nonce[0] == 0) continue;
    break;
  }
  var cloaked = Buffer.concat([nonce, chacha20.encrypt(key, nonce, packet)]);
  rounds--;
  return (rounds) ? exports.cloak(cloaked, key, rounds) : cloaked;
}

exports.decloak = function(cloaked, key, rounds)
{
  if(!(key = keyize(key)) || !Buffer.isBuffer(cloaked) || cloaked.length < 2) return undefined;
  if(!rounds) rounds = 0;
  if(cloaked[0] == 0)
  {
    var packet = exports.decode(cloaked);
    if(packet) packet.cloaked = rounds;
    return packet;
  }
  if(cloaked.length < 10) return undefined; // must have cloak and a minimum packet
  rounds++;
  return exports.decloak(chacha20.decrypt(key, cloaked.slice(0,8), cloaked.slice(8)), key, rounds);
}

// framing stream
var Duplex = require('stream').Duplex;
exports.framing = function(args, cbPacket){
  if(!args) args = {};
  if(!cbPacket) cbPacket = function(err, packet){ };

  // frames must be 16-128
  var size = (args.size <= 128 && args.size >= 16)?args.size:32;
  var space = size - 4;
  
  var stream = new Duplex({allowHalfOpen:false});
  var outbox = [];
  
  // incoming framed data coming from another stream
  var cache = new Buffer(0);
  var raw = new Buffer(0);
  stream._write = function(data,enc,cbWrite)
  {
    // trigger an error when http is detected, but otherwise continue
    if(raw.length == 0 && data.slice(0,5).toString() == 'GET /')
    {
      cbPacket("HTTP detected",data);
    }
    raw = Buffer.concat([raw,data]);
    while(raw.length > size)
    {
      var len = data.readUInt8(0);
      // packet done or ack
      if(len === 0)
      {
        blocked = false;
        if(frames.length)
        {
          var packet = exports.decode(frames);
          frames = new Buffer(0);
          if(packet) cbPacket(false, packet);
        }
        data = data.slice(1);
        continue;
      }
      // not a full frame yet, wait for more
      if(data.length < (len+1)) break;

      // full frame, buffer it up
      blocked = false;
      frames = Buffer.concat([frames,data.slice(1,len+1)]);
      data = data.slice(len+1);
      // ensure a response when enabled
      if(args.ack)
      {
        if(!queue.length) queue.push(new Buffer("\0"));
      }
    }
    stream.send(); // always try sending more data
    cbWrite();
  }

  // accept packets to be frameed
  stream.send = function(packet)
  {
    // break packet into frames and add to queue
    while(packet)
    {
      var len = new Buffer(1);
      var frame = packet.slice(0,space);
      packet = packet.slice(frame.length);
      len.writeUInt8(frame.length,0);
      // check if we can include the packet terminating zero
      var zero = new Buffer(0);
      if(packet.length == 0 && frame.length <= space)
      {
        zero = new Buffer("\0");
        packet = false;
      }
      queue.push(Buffer.concat([len,frame,zero]));
    }

    // pull next frame off the queue
    if(queue.length && !blocked)
    {
      var frame = queue.shift();
      if(args.blocking && frame.length > 1) blocked = true;
      if(stream.push(frame)) stream.send(); // let the loop figure itself out
    }
  }

  // try sending more frames
  stream._read = function(size)
  {
    stream.send();
  }

  return stream;
}
