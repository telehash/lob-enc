// encode a packet
exports.encode = function(head, body)
{
  // support different arg types
  if(head === null) head = false; // grrrr
  if(typeof head == 'number') head = new Buffer(String.fromCharCode(json));
  if(typeof head == 'object' && !Buffer.isBuffer(head)) head = new Buffer(JSON.stringify(head));
  head = head || new Buffer(0);
  if(typeof body == "string") body = new Buffer(body, "binary");
  body = body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(head.length, 0);
  return Buffer.concat([len, head, body]);
}

// packet decoding
exports.decode =function(bin)
{
  if(!bin) return undefined;
  var buf = (typeof bin == "string") ? new Buffer(bin, "binary") : bin;
  if(bin.length < 2) return undefined;

  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len > (buf.length - 2)) return undefined;
  var head = buf.slice(2, len+2);
  var body = buf.slice(len + 2);

  // parse out the json
  var json = {};
  if(len >= 7)
  {
    try {
      json = JSON.parse(head.toString("utf8"));
    } catch(E) {
      return undefined;
    }
  }
  return {json:json, length:buf.length, head:head, body:body};
}

exports.isPacket = function(packet)
{
  if(typeof packet != 'object') return false;
  if(typeof packet.json != 'object') return false;
  if(typeof packet.length != 'number') return false;
  if(!Buffer.isBuffer(packet.head)) return false;
  if(!Buffer.isBuffer(packet.body)) return false;
  return true;
}