var expect = require('chai').expect;
var lob = require('../index.js');


describe('hashname', function(){

  it('should encode', function(){
    var json = {
      "type":"test",
      "foo":["bar"]
    };
    var body = new Buffer("any binary!");
    var bin = lob.encode(json, body);
    expect(Buffer.isBuffer(bin)).to.be.equal(true);
    expect(bin.length).to.be.equal(42);
  });

  it('should decode', function(){
    var bin = new Buffer('001d7b2274797065223a2274657374222c22666f6f223a5b22626172225d7d616e792062696e61727921','hex');
    var packet = lob.decode(bin);
    expect(packet).to.be.a('object');
    expect(packet.json.type).to.be.equal('test');
    expect(packet.body.length).to.be.equal(11);
  });


})