use super::{ApprovalLevel, ToolOutcome, ToolSpec};
use rig_core::completion::ToolAnnotations;
use serde_json::{json, Value};

pub const NAME: &str = "calculate";
const MAX_EXPRESSION_CHARS: usize = 256;
const MAX_DEPTH: usize = 64;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "计算一个四则运算表达式，支持加减乘除、括号、小数与一元正负号。不支持变量、函数或任何其他语法。需要精确算术结果时使用，不要自行心算。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "仅含数字、小数点、+ - * / 、括号与空白的表达式，例如 (12 + 8) * 3 / 4"
                }
            },
            "required": ["expression"],
            "additionalProperties": false
        }),
        approval: ApprovalLevel::Auto,
        annotations: ToolAnnotations::default()
            .with_read_only(true)
            .with_idempotent(true)
            .with_open_world(false),
    }
}

pub fn run(arguments: &Value) -> ToolOutcome {
    let Some(expression) = arguments.get("expression").and_then(Value::as_str) else {
        return ToolOutcome::error("缺少 expression 参数，或它不是字符串。");
    };
    match evaluate(expression) {
        Ok(value) => ToolOutcome::ok(format!("{value}")),
        Err(message) => ToolOutcome::error(message),
    }
}

fn evaluate(expression: &str) -> Result<f64, String> {
    if expression.chars().count() > MAX_EXPRESSION_CHARS {
        return Err(format!("表达式过长，最多 {MAX_EXPRESSION_CHARS} 个字符。"));
    }
    // A whitelist, not a blacklist: anything outside it is rejected before parsing,
    // so no identifier, function call or evaluation surface can reach the parser.
    if !expression.chars().all(|c| {
        matches!(
            c,
            '0'..='9' | '.' | '+' | '-' | '*' | '/' | '(' | ')' | ' ' | '\t'
        )
    }) {
        return Err("表达式只允许数字、小数点、四则运算符、括号与空白。".into());
    }
    let tokens: Vec<char> = expression.chars().filter(|c| !c.is_whitespace()).collect();
    if tokens.is_empty() {
        return Err("表达式为空。".into());
    }
    let mut parser = Parser {
        tokens: &tokens,
        pos: 0,
        depth: 0,
    };
    let value = parser.expression()?;
    if parser.pos != tokens.len() {
        return Err("表达式含无法解析的多余字符。".into());
    }
    if !value.is_finite() {
        return Err("计算结果不是有限数值。".into());
    }
    Ok(value)
}

struct Parser<'a> {
    tokens: &'a [char],
    pos: usize,
    depth: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<char> {
        self.tokens.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let next = self.peek();
        if next.is_some() {
            self.pos += 1;
        }
        next
    }

    fn enter(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err("表达式嵌套过深。".into());
        }
        Ok(())
    }

    fn expression(&mut self) -> Result<f64, String> {
        self.enter()?;
        let mut value = self.term()?;
        while let Some(op @ ('+' | '-')) = self.peek() {
            self.bump();
            let rhs = self.term()?;
            value = if op == '+' { value + rhs } else { value - rhs };
            if !value.is_finite() {
                return Err("计算结果不是有限数值。".into());
            }
        }
        Ok(value)
    }

    fn term(&mut self) -> Result<f64, String> {
        self.enter()?;
        let mut value = self.factor()?;
        while let Some(op @ ('*' | '/')) = self.peek() {
            self.bump();
            let rhs = self.factor()?;
            if op == '/' && rhs == 0.0 {
                return Err("除数为零。".into());
            }
            value = if op == '*' { value * rhs } else { value / rhs };
            if !value.is_finite() {
                return Err("计算结果不是有限数值。".into());
            }
        }
        Ok(value)
    }

    fn factor(&mut self) -> Result<f64, String> {
        self.enter()?;
        match self.peek() {
            Some('+') => {
                self.bump();
                self.factor()
            }
            Some('-') => {
                self.bump();
                self.factor().map(|value| -value)
            }
            Some('(') => {
                self.bump();
                let value = self.expression()?;
                if self.bump() != Some(')') {
                    return Err("括号不匹配。".into());
                }
                Ok(value)
            }
            Some(c) if c.is_ascii_digit() || c == '.' => self.number(),
            _ => Err("表达式缺少操作数或含意外字符。".into()),
        }
    }

    fn number(&mut self) -> Result<f64, String> {
        let start = self.pos;
        let mut dots = 0;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() {
                self.bump();
            } else if c == '.' {
                dots += 1;
                if dots > 1 {
                    return Err("数字含多个小数点。".into());
                }
                self.bump();
            } else {
                break;
            }
        }
        let text: String = self.tokens[start..self.pos].iter().collect();
        text.parse::<f64>()
            .map_err(|_| "数字格式无效。".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(expression: &str) -> f64 {
        evaluate(expression).unwrap_or_else(|error| panic!("{expression}: {error}"))
    }

    #[test]
    fn ai_assistant_tools_calculate_honours_precedence_and_parentheses() {
        assert_eq!(value("2 + 3 * 4"), 14.0);
        assert_eq!(value("(2 + 3) * 4"), 20.0);
        assert_eq!(value("10 / 4"), 2.5);
        assert_eq!(value("-3 + 5"), 2.0);
        assert_eq!(value("-(2 + 3)"), -5.0);
        assert_eq!(value("  12\t+ 8 "), 20.0);
        assert_eq!(value(".5 * 4"), 2.0);
        assert_eq!(value("2 * -3"), -6.0);
    }

    #[test]
    fn ai_assistant_tools_calculate_rejects_injection_and_malformed_input() {
        for expression in [
            "alert(1)",
            "process.env",
            "1; DROP TABLE",
            "x + 1",
            "2 ** 3",
            "1e5",
            "()",
            "(1 + 2",
            "1 +",
            "1..2",
            "",
            "   ",
            "1 / 0",
            "9".repeat(300).as_str(),
        ] {
            assert!(
                evaluate(expression).is_err(),
                "应拒绝但通过了：{expression}"
            );
        }
    }

    #[test]
    fn ai_assistant_tools_calculate_bounds_nesting_depth() {
        let deep = format!("{}1{}", "(".repeat(200), ")".repeat(200));
        assert!(evaluate(&deep).is_err());
    }

    #[test]
    fn ai_assistant_tools_calculate_reports_errors_without_panicking() {
        let outcome = run(&json!({"expression": "1 / 0"}));
        assert!(outcome.is_error);
        assert!(outcome.content.contains("除数为零"));
        assert!(run(&json!({})).is_error);
        assert!(run(&json!({"expression": 42})).is_error);
        assert!(!run(&json!({"expression": "6 * 7"})).is_error);
        assert_eq!(run(&json!({"expression": "6 * 7"})).content, "42");
    }
}
