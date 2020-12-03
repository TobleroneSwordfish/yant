"use strict";
const mocha = require("mocha");
const t = require("./templating.js");
const assert = require("assert");
const capture_stdout = require("capture-stdout");

//function to verify stdout since our module mostly fails gracefully
//returns the return value of the function it verifies so that that value can then be verified
function assert_stdout(output, func) {
    var result;
    const capture = new capture_stdout();
    capture.startCapture();
    try{
        result = func();
    }
    catch(error) {
        capture.stopCapture();
        throw error;
    }
    capture.stopCapture();
    assert.deepStrictEqual(capture.getCapturedText(), output);
    return result;
}

describe("assert_stdout", function(){
    it("should pass on correct output", function(){
        assert_stdout(["foo"], () => console.log("foo"));
    });
    it("should pass on multiline output", function(){
        assert_stdout(["foo", "bar"], function(){
            console.log("foo");
            console.log("bar");
        });
    });
    it("should fail on incorrect output", function(){
        assert.throws(function(){
            assert_stdout(["foo"], () => console.log("bar"));
        }, Error);
    });
    it("should not suppress internal errors", function(){
        assert.throws(
            () => assert_stdout("", () => assert(false)),
            {name:"AssertionError", message:"The expression evaluated to a falsy value:\n\n  assert(false)\n"}
        );
    })
});

describe("direct substitution", function(){
    describe("output validity", function(){
        it("should substitute", function(){
            assert.strictEqual(t.template("${foo}", {foo:"bar"}), "bar");
        });
        it("should work multiple times", function(){
            assert.strictEqual(t.template("${foo}${bar}", {foo:"lemon",bar:"ade"}), "lemonade");
        });
        it("should not further evaluate", function(){
            assert.strictEqual(t.template("${foo}", {foo:"${bar}"}), "${bar}");
        })
    });
    describe("syntax errors", function(){
        it("should error on lone starting character", function(){
            assert.strictEqual(
                assert_stdout(
                    t.generate_error("Missing { to match $", 0),
                    () => t.template("$abcd",{})
                ),
                "$abcd"
            );
        });
        it("should error on unclosed brackets", function(){
            assert.strictEqual(
                assert_stdout(
                    t.generate_error("Missing }", 0),
                    () => t.template("${abcd", {})
                ),
                "${abcd"
            );
        });
        it("should error on expression not evaluating in template map", function(){
            assert.strictEqual(
                assert_stdout(
                    t.generate_error("Error evaluating expression: foo"),
                    () => t.template("${foo}", {})
                ),
                ""
            );
        });
    });
});

describe("if", function(){
    it("should substitute if true", function(){
        assert.strictEqual(
            t.template("$if(bool){foo}", {bool:true}),
            "foo"
        )
    });
    it("should clear if false", function(){
        assert.strictEqual(
            t.template("$if(bool){foo}", {bool:false}),
            ""
        )
    });
    it("should still ")
});