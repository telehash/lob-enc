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
  if(!args.size || args.size > 255) args.size = 255; // 1 to 255 bytes
  if(!args.ack) args.ack = "none"; // "chunk" or "packet"
  if(!cbPacket) cbPacket = function(err, packet){ };

  var stream = new Duplex({allowHalfOpen:false});
  
  // incoming chunked data coming from another stream
  var chunks = new Buffer(0);
  var data = new Buffer(0);
  stream._write = function(data2,enc,cbWrite)
  {
    data = Buffer.concat([data,data2]);
    while(data.length)
    {
      var len = data.readUInt8(0);
      // packet done
      if(len === 0)
      {
        if(chunks.length)
        {
          var packet = exports.decode(chunks);
          chunks = new Buffer(0);
          if(packet) cbPacket(false, packet);
          if(args.ack == "packet") stream.push(new Buffer("\0")); // send per-chunk ack
        }else{
          // an extra 0 alone is an ack, clear acking state
          acking = false;
        }
        data = data.slice(1);
        continue;
      }
      // not a full chunk yet, wait for more
      if(data.length < (len+1)) break;
      // buffer up some more chunk data
      chunks = Buffer.concat([chunks,data.slice(1,len+1)]);
      data = data.slice(len+1);
      if(args.ack == "chunk") stream.push(new Buffer("\0")); // send per-chunk ack
    }
    cbWrite();
  }

  // accept packets to be chunked
  var queue = [];
  var buf = new Buffer(0);
  var acking = false;
  stream.send = function(packet)
  {
    if(packet) queue.push(packet);
    // pull next packet to be chunked off the queue
    if(buf.length == 0 && queue.length && acking != "packet")
    {
      buf = queue.shift();
      if(args.ack == "packet") acking = args.ack;
    }
    // if any chunks need to be sent, do that
    if(buf.length && acking != "chunk")
    {
      var len = new Buffer(1);
      var chunk = buf.slice(0,args.size);
      buf = buf.slice(chunk.length);
      len.writeUInt8(chunk.length,0);
      // check if we need to include the packet terminating zero
      var zero = (buf.length) ? (new Buffer(0)) : (new Buffer("\0"));
      if(args.ack == "chunk") acking = args.ack;
      if(stream.push(Buffer.concat([len,chunk,zero]))) stream.send(); // let the loop figure itself out
    }
  }

  // try sending more chunks
  stream._read = function(size)
  {
    stream.send();
  }

  return stream;
}

