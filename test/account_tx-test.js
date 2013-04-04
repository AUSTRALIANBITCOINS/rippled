var async       = require("async");
var buster      = require("buster");

var Amount      = require("../src/js/amount").Amount;
var Remote      = require("../src/js/remote").Remote;
var Transaction = require("../src/js/transaction").Transaction;
var Server      = require("./server").Server;

var testutils = require("./testutils");

require('../src/js/config').load(require('./config'));

buster.testRunner.timeout = 250000; //This is a very long test!


// Hard-coded limits we'll be testing:
var BINARY_LIMIT = 500;
var NONBINARY_LIMIT = 200;

var ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
var FIRST_BATCH = 199; // Within both limits
var OFFSET = 180;
var LIMIT = 170;
var SECOND_BATCH = 10; // Between NONBINARY_LIMIT and BINARY_LIMIT
var THIRD_BATCH = 295; // Exceeds both limits

buster.testCase("// Account_tx tests", {
  'setUp'     : testutils.build_setup(),
  'tearDown'  : testutils.build_teardown(),

  "make a lot of transactions and query using account_tx" :
    function (done) {
		var self = this;
		var final_create;
		 
		var transactionCounter = 0;
		  
		var createOfferFunction = function (callback) {
			self.remote.transaction()
				.offer_create("root", "500", "100/USD/root")
				.on('proposed', function (m) {
					transactionCounter++;
					console.log('Submitted transaction', transactionCounter);
					callback(m.result !== 'tesSUCCESS');
				})
				.on('final', function (m) {
					buster.assert.equals('tesSUCCESS', m.metadata.TransactionResult);
					buster.assert(final_create);
				})
				.submit();
		};
		  
		function lotsOfTransactions(number, whenDone) {
			var bunchOfOffers = [];
			for (var i=0; i<number; i++) {
				bunchOfOffers.push(createOfferFunction);
			}
			async.parallel(bunchOfOffers, function (error) {
				buster.refute(error);
				self.remote
					.once('ledger_closed', function (message) {
						final_create = message;
					})
					.ledger_accept();
				whenDone();
			});
		}
		  
		function firstBatch() {
			lotsOfTransactions(FIRST_BATCH,
				function(){runTests(self, FIRST_BATCH, 0,      0, 
				function(){runTests(self, FIRST_BATCH, OFFSET, 0, 
				function(){runTests(self, FIRST_BATCH, 0,      LIMIT, secondBatch)})}
			)});
		}
		
		function secondBatch() {
			lotsOfTransactions(SECOND_BATCH,
				function(){runTests(self, FIRST_BATCH+SECOND_BATCH, 0,      0, 
				function(){runTests(self, FIRST_BATCH+SECOND_BATCH, OFFSET, 0,     thirdBatch)}
			)});
		}
		
		function thirdBatch() {
			lotsOfTransactions(THIRD_BATCH,
				function(){runTests(self, FIRST_BATCH+SECOND_BATCH+THIRD_BATCH, 0,      0, 
				function(){runTests(self, FIRST_BATCH+SECOND_BATCH+THIRD_BATCH, OFFSET, 0,     done)}
			)});
		}
		
		firstBatch();
		
		
		function standardErrorHandler(callback) {
			return function(r) {
				console.log("ERROR!");
				console.log(r);
				callback(r);
			}
		}
		  
		  
		function runTests(self, actualNumberOfTransactions, offset, limit, finalCallback) {
			console.log("Testing batch with offset and limit:", offset, limit);
			async.series([
				function(callback) {
					console.log('nonbinary');
					self.remote.request_account_tx({
						account:ACCOUNT,
						ledger_index_min:0,
						ledger_index_max:5,
						offset:offset,
						limit:limit
					}).on('success', function (r) {
						buster.assert(r.transactions, "No transactions returned.");
						var targetLength = Math.min(NONBINARY_LIMIT, limit ? Math.min(limit,actualNumberOfTransactions-offset) : actualNumberOfTransactions-offset);
						buster.assert(r.transactions.length == targetLength, "Got "+r.transactions.length+" transactions; expected "+targetLength );
						
						//Check for proper ordering.
						for (var i=0; i<r.transactions.length-1; i++) {
							var t1 = r.transactions[i].tx;
							var t2 = r.transactions[i+1].tx;
							buster.assert(t1.inLedger<t2.inLedger  ||  (t1.inLedger==t2.inLedger && t1.hash < t2.hash ), 
								"Transactions were not ordered correctly: "+t1.inLedger+"#"+t1.hash+" should not have come before "+t2.inLedger+"#"+t2.hash);
						}
						callback(false);
					})
					.on('error', standardErrorHandler(callback))
					.request();
				},
				
				function(callback) {
					console.log('binary');
					self.remote.request_account_tx({
						account:ACCOUNT,
						ledger_index_min:0,
						ledger_index_max:5,
						binary:true,
						offset:offset,
						limit:limit
					}).on('success', function (r) {
						buster.assert(r.transactions, "No transactions returned.");
						var targetLength = Math.min(BINARY_LIMIT, limit ? Math.min(limit,actualNumberOfTransactions-offset) : actualNumberOfTransactions-offset);
						buster.assert(r.transactions.length == targetLength, "Got "+r.transactions.length+" transactions; expected "+targetLength );
						callback(false);
					})
					.on('error', standardErrorHandler(callback))
					.request();
				},

				function(callback) {
					console.log('nonbinary+offset');
					self.remote.request_account_tx({
						account:ACCOUNT,
						ledger_index_min:0,
						ledger_index_max:5,
						descending:true,
						offset:offset,
						limit:limit
					}).on('success', function (r) {
						buster.assert(r.transactions, "No transactions returned.");
						var targetLength = Math.min(NONBINARY_LIMIT, limit ? Math.min(limit,actualNumberOfTransactions-offset) : actualNumberOfTransactions-offset );
						buster.assert(r.transactions.length == targetLength, "Got "+r.transactions.length+" transactions; expected "+targetLength );
						//Check for proper ordering.
						for (var i=0; i<r.transactions.length-1; i++) {
							var t1 = r.transactions[i].tx;
							var t2 = r.transactions[i+1].tx;
							buster.assert(t1.inLedger>t2.inLedger  ||  (t1.inLedger==t2.inLedger && t1.hash > t2.hash  ),
								"Transactions were not ordered correctly: "+t1.inLedger+"#"+t1.hash+" should not have come before "+t2.inLedger+"#"+t2.hash);
						}
						callback(false);
					})
					.on('error', standardErrorHandler(callback))
					.request();
				},


				], function (error) {
					buster.refute(error);
					finalCallback();
				}
			);
		}
	}
});



// TODO:
// Test the "count" feature.