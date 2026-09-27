// Animated terminals for the command-line manual, as Typer's documentation
// has them — taken from Typer's docs/js/custom.js (MIT License,
// https://github.com/fastapi/typer), its terminal part only.
//
// A ```console block inside <div class="termy"> becomes a termynal:
// "$ " lines are typed in, "// " lines are comments, "---> 100%" is a
// progress bar, and every other line is output.

function escapePlainCliLine(line) {
    return line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function prepareTermynalLines(lines, isRichHtml) {
    if (isRichHtml) {
        return lines.join("<br>");
    }
    return lines.map(escapePlainCliLine).join("<br>");
}

function setupTermynal() {
    document.querySelectorAll(".use-termynal").forEach(node => {
        node.style.display = "block";
        new Termynal(node, {
            lineDelay: 500
        });
    });
    const progressLiteralStart = "---> 100%";
    const promptLiteralStart = "$ ";
    const customPromptLiteralStart = "# ";
    const termynalActivateClass = "termy";
    let termynals = [];

    function createTermynals() {
        document
            .querySelectorAll(`.${termynalActivateClass} .highlight code`)
            .forEach(node => {
                const text = node.textContent;
                const lines = text.split("\n");
                // If it is a type in brackets like <str> or <str int boolean>, it won't have
                // HTML attributes (=) or a closing tag, while Rich HTML tags do.
                const hasHtmlAttribute = /<[A-Za-z][^>]*=/.test(text);
                const hasClosingTag = /<\/[a-zA-Z0-9]/.test(text);
                const isRichHtml = hasHtmlAttribute || hasClosingTag;
                const useLines = [];
                let buffer = [];
                function saveBuffer() {
                    if (buffer.length) {
                        let isBlankSpace = true;
                        buffer.forEach(line => {
                            if (line) {
                                isBlankSpace = false;
                            }
                        });
                        const dataValue = {};
                        if (isBlankSpace) {
                            dataValue["delay"] = 0;
                        }
                        if (buffer[buffer.length - 1] === "") {
                            // A last single <br> won't have effect
                            // so put an additional one
                            buffer.push("");
                        }
                        const bufferValue = prepareTermynalLines(buffer, isRichHtml);
                        dataValue["value"] = bufferValue;
                        useLines.push(dataValue);
                        buffer = [];
                    }
                }
                for (let line of lines) {
                    if (line === progressLiteralStart) {
                        saveBuffer();
                        useLines.push({
                            type: "progress"
                        });
                    } else if (line.startsWith(promptLiteralStart)) {
                        saveBuffer();
                        const value = line.replace(promptLiteralStart, "").trimEnd();
                        useLines.push({
                            type: "input",
                            value: value
                        });
                    } else if (line.startsWith("// ")) {
                        saveBuffer();
                        let comment = line.replace("// ", "").trimEnd();
                        if (!isRichHtml) {
                            comment = escapePlainCliLine(comment);
                        }
                        const value = "💬 " + comment;
                        useLines.push({
                            value: value,
                            class: "termynal-comment",
                            delay: 0
                        });
                    } else if (line.startsWith(customPromptLiteralStart)) {
                        saveBuffer();
                        const promptStart = line.indexOf(promptLiteralStart);
                        if (promptStart === -1) {
                            console.error("Custom prompt found but no end delimiter", line)
                        }
                        const prompt = line.slice(0, promptStart).replace(customPromptLiteralStart, "")
                        let value = line.slice(promptStart + promptLiteralStart.length);
                        useLines.push({
                            type: "input",
                            value: value,
                            prompt: prompt
                        });
                    } else {
                        buffer.push(line);
                    }
                }
                saveBuffer();
                const inputCommands = useLines.filter(line => line.type === "input").map(line => line.value).join("\n");
                node.textContent = inputCommands;
                const div = document.createElement("div");
                node.style.display = "none";
                node.after(div);
                const termynal = new Termynal(div, {
                    lineData: useLines,
                    noInit: true,
                    lineDelay: 500
                });
                termynals.push(termynal);
            });
    }

    function loadVisibleTermynals() {
        termynals = termynals.filter(termynal => {
            if (termynal.container.getBoundingClientRect().top - innerHeight <= 0) {
                termynal.init();
                return false;
            }
            return true;
        });
    }
    window.addEventListener("scroll", loadVisibleTermynals);
    createTermynals();
    loadVisibleTermynals();
}

document$.subscribe(() => {
    setupTermynal()
})
