"use strict"
let http = require("http");
let fs = require('fs');
let templating = require("./templating.js")

templating.load_globals("./content/globals.html");

var server = http.createServer(handle)
server.listen(8080);

var last_comment_id = 0;

function comment(content, user_id, children) {
    var com = {};
    com.content = content;
    com.user_id = user_id;
    com.children = children;
    com.id = last_comment_id++;
    return com;
}

var templateMap = {};
templateMap.time = (new Date());
templateMap.test = "foo";
templateMap.special_string = "Foo}}{)*\"$\"}$";

templateMap.users = ["Alice", "Bob"];
templateMap.comments = [
    comment("Foo", 0, [
        comment("Bar", 1, [
            
        ])
    ]),
    comment("Yes", 0, [])
]

templateMap.bool = false;

async function handle(req, resp) {
    if (req.method == "GET") {
        if (req.url == "/") {
            req.url = "/index.html";
            if (Math.random() > 0.5) {
                templateMap.bool = true;
            }
            else {
                templateMap.bool = false;
            }
        }
        else if (req.url == "/favicon.ico") {
            resp.end();
            return;
        }

        //no security as this is just a local test server
        var content = await fs.readFileSync("./content" + req.url, "utf8");
        
        content = templating.template(content,templateMap);
        resp.write(content);
        resp.end();
    }
}