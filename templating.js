"use strict"
const vm = require("vm");
const fs = require("fs");
var globalMap = {};

// log("Module loaded");

/** 
 * Loads $declare statements from a file into a global map availible to all templating operations of this module instance.
 * Any other statements will be parsed, but discarded.
 * @param filepath The file containing $declares
 */
async function load_globals(filepath) {
    var content = await fs.readFileSync(filepath, "utf8");
    globalMap = {...globalMap, ...template(content, {}, true)};
}
exports.load_globals = load_globals;

//the last param is optional and excluded from the exported version,
//just makes it return the template_map instead of the content
//for loading global $declares

function template(content, template_map, returnMap) {
    //don't load the global map if we are in the process of constructing it
    if (!returnMap) {
        template_map = {...globalMap, ...template_map};
    }
    if (typeof(content) != "string") {
        if (typeof(content) == "number") {
            content = content.toString();
        }
        else {
            throw new Error(`content should have type string, not ${typeof(content)}`);
        }
    }
    if (typeof(template_map) != "object") {
        throw new Error(`template_map should have type object, not ${typeof(template_map)}`);
    }
    var state = {content:content, index:0, template_map:template_map}
    state.index = state.content.indexOf("$");
    while(state.index != -1) {
        state = process_content(state);
        state.index = state.content.indexOf("$", state.index);
    }
    //return either the templated content or the map of globals
    return returnMap ? state.template_map : state.content;
}

//parse one statement from content, with $ at i according to template_map
function process_content(state) {
    //literal escape must be handled separately as it must use a custom end block sequence
    if (state.content.substring(state.index).startsWith("$${")) {
        var escape_end = state.content.indexOf("}$$",state.index);
        if (escape_end < 0) {
            error(`Lone escape sequence $\${ found at index ${state.index}`);
            state.index += 3;
        }
        else {
            var escape_length = escape_end - (state.index + 3);
            state.content = state.content.substring(0, state.index) + state.content.substring(state.index + 3, escape_end) + state.content.substring(escape_end + 3);
            state.index += escape_length;
        }
    }
    else {
        //construct the statement object
        var statement = parse_statement(state.content, state.index + 1);
        if (statement.error) {
            error(statement.error, state.index);
            state.index++;
        }
        else {
            //get the result of the statement
            var result = execute_statement(statement, state.template_map);
            //replace the statement in the content with its result
            state.content = state.content.substring(0, state.index) + result.block + state.content.substring(statement.end);
            if (result.cursor_offset) {
                state.index += result.cursor_offset;
            }
        }
    }
    return state;
}

/**
 * Parses content using the values contained within template_map
 *
 * @param content A string containing the page content to be parsed
 * @param template_map An object whose properties represent variables availible to the templating engine.
 *  Example: template_map.foo = "bar" allows for ${foo} to be evaluated to bar
 * @return The page content, with all template language statements evaluated
 */
function external_template(content, template_map) {
    return template(content, template_map);
}
exports.template = external_template;

//parse a single statement from content, starting at i
function parse_statement(content, i) {
    var statement = {};
    statement.start = i;
    var param_start = content.indexOf("(", i);
    var block_start = content.indexOf("{", i);
    if (block_start < 0) {
        statement.error = "Missing { to match $";
        return statement;
    }
    //do we have parameters
    if (param_start < block_start && param_start >= 0) {
        //get the parameters between the () brackets
        statement.parameters = content.substring(param_start + 1, find_end(content, "()", param_start) - 1);
        statement.keyword = content.substring(i, param_start);
    }
    else {
        statement.keyword = content.substring(i, block_start);
    }
    var blockEnd = find_end(content, "{}", block_start);
    if (blockEnd < 0) {
        statement.error = "Missing }";
        return statement;
    }
    //special case for else case, will generalise if needed again
    if (content.substring(blockEnd).startsWith("else{")) {
        var elseEnd = find_end(content, "{}", blockEnd + "else{".length - 1);
        if (elseEnd < 0) {
            statement.error = "Missing }";
            return statement;
        }
        statement.block = content.substring(block_start + 1, elseEnd - 1);
        statement.end = elseEnd;
    }
    else {
        statement.block = content.substring(block_start + 1, blockEnd - 1);
        statement.end = blockEnd;
    }
    return statement;
}


function execute_statement(statement, template_map) {
    var result;
    if (statement.keyword == "") { //escape is the default action
        statement.keyword = "escape";
    }
    if (statement_map[statement.keyword] != null) {
        result = statement_map[statement.keyword](statement, template_map);
    }
    else {
        error(`Unknown statement \"${statement.keyword}\"`, statement.start);
        result = "";
    }
    //we allow the template functions to return either a string or an object for simplicity
    //since escape is the only one that needs to move the cursor currently
    if (typeof result != "object") {
        return {block:result};
    }
    else {
        return result;
    }
}

//maps the keywords to the functions that execute them
var statement_map = {};

//--- Start of templating functions ---
// Each function takes a statement object (defined by the constructor parse_statement)
// and a template_map of variable names to objects

statement_map.escape = function template_escape(statement, template_map) {
    var value = evaluate(statement.block, template_map).toString();
    //tell the top level template function to skip evaluating the text we send it
    //this is to allow for substitution of strings involving special characters
    return {block:value, cursor_offset:value.length};
}

statement_map.eval = function template_substitute(statement, template_map) {
    var key = statement.block;
    return evaluate(key, template_map);
}

statement_map.if = function template_if(statement, template_map) {
    var value = evaluate(statement.parameters, template_map);
    var first_block_end = find_end("{" + statement.block, "{}", 0) - 1;
    if (first_block_end < 0) {
        //no else case
        if (value) {
            return statement.block;
        }
        else {
            return "";
        }
    }
    else if (statement.block.substring(first_block_end).startsWith("else{")) {
        if (value) {
            return statement.block.substring(0,first_block_end - 1);
        }
        else {
            var else_start = first_block_end  + "else{".length;
            var else_end = find_end(statement.block, "{}", else_start);
            if (else_end < 0) {
                else_end = statement.block.length;
            }
            var else_block = statement.block.substring(else_start, else_end);
            return else_block;
        }
    }
    else {
        //the block has not ended, but the connective is incorrect
        error(`Invalid connective after if statement ${statement.parameters}`, statement.start);
        return "";
    }
}

statement_map.foreach = function template_foreach(statement, template_map) {
    var params = statement.parameters.split(" in ");
    var keyName = params[0];
    var array = evaluate(params[1], template_map);
    if (!is_iterable(array)) {
        error(`Cannot iterate type ${typeof(array)}`, statement.start);
        return "";
    }
    let new_content = "";
    //recurse down to template the body
    for (const value of array) {
        var local_map = {};
        local_map[keyName] = value;
        var full_template = {...template_map, ...local_map}
        var block = template(statement.block, full_template)
        new_content = new_content.concat(block);
    };
    return new_content;
}

statement_map.declare = function template_declare(statement, template_map) {
    template_map[statement.parameters] = statement.block;
    return "";
}

//--- End of templating functions

function find_end(content, symbolPair, i) {
    //split in two
    symbolPair = [symbolPair.substring(0,symbolPair.length / 2), symbolPair.substring(symbolPair.length / 2)]
    if (!content.substring(i).startsWith(symbolPair[0])) {
        return -1;
    }
    i+= symbolPair[0].length;
    var bracketCount = 0;
    while (bracketCount >= 0) {
        if (i >= content.length) {
            return -1
        }
        if (content.substring(i).startsWith(symbolPair[0])) {
            bracketCount++;
        }
        else if (content.substring(i).startsWith(symbolPair[1])) {
            bracketCount--;
        }
        i++;
    }
    return i;
}

function is_iterable(obj) {
    if (obj == null) {
      return false;
    }
    return typeof obj[Symbol.iterator] === "function";
  }

//use a javascript VM to evaluate the template code
//not a security hole as all the code executed is stored server-side
function evaluate(code, template_map) {
    try {
        var context = new vm.createContext(template_map);
        var script = new vm.Script(code);
        return script.runInContext(context);
    }
    catch (err) {
        error("Error evaluating expression: " + code);
        return "";
    }
}

function log(msg, level, index) {
    for (const line of generate_log(msg, level, index)) {
        console.log(line);
    }
}
function generate_log(msg, level, index) {
    var output = [];
    if (level == "error") {
        output.push("\x1b[31mTemplating error:")
    }
    else {
        output.push("Templating log:");
    }
    output.push(msg)
    if (index != undefined) {
        output.push(`at index ${index}`);
    }
    output.push("\x1b[0m");
    return output;
}
exports.generate_log = generate_log;

const error = (msg, index) => log(msg, "error", index);
//export a function to generate error strings for testing
exports.generate_error = (msg, index) => generate_log(msg, "error", index);