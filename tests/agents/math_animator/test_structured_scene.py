from deeptutor.agents.math_animator.models import ConceptAnalysis, SceneDesign
from deeptutor.agents.math_animator.structured_scene import structured_manim_code


def test_structured_scene_contains_real_formula_and_avoids_tex():
    generated = structured_manim_code(
        user_input="显示 V = a^3（三个 a 相乘）和 3^3 = 3 * 3 * 3 = 27。",
        analysis=ConceptAnalysis(),
        design=SceneDesign(title="立方体体积"),
    )

    assert "class StructuredMathScene(Scene)" in generated.code
    assert "V = a³" in generated.code
    assert "3³ = 3 * 3 * 3 = 27" in generated.code
    assert "MathTex" not in generated.code
    assert "Tex(" not in generated.code


def test_structured_scene_does_not_leak_prompt_instructions_and_meets_duration():
    generated = structured_manim_code(
        user_input="生成约 5 秒动画，显示 V = a^3 和 3^3 = 27，不要复杂几何体，纯公式文本展示即可。",
        analysis=ConceptAnalysis(),
        design=SceneDesign(title="立方体体积"),
    )

    assert "不要复杂几何体" not in generated.code
    assert "纯公式文本展示即可" not in generated.code
    assert "V = a³" in generated.code
    assert "3³ = 27" in generated.code
    # 0.6 intro + 2 × 0.65 formula reveals + 3.1 final hold = 5 seconds.
    assert "self.wait(3.100)" in generated.code


def test_structured_scene_can_omit_title():
    generated = structured_manim_code(
        user_input="不显示标题，约 5 秒，只显示 V = a^3 和 3^3 = 27。",
        analysis=ConceptAnalysis(),
        design=SceneDesign(title="不应出现的标题"),
    )

    assert "不应出现的标题" not in generated.code
    assert "title = Text" not in generated.code
    assert "previous = None" in generated.code
    assert "V = a³" in generated.code


def test_structured_scene_splits_chinese_yu_into_two_formula_lines():
    generated = structured_manim_code(
        user_input="不显示标题，只显示 V = a³ 与 3³ = 27，约 5 秒。",
        analysis=ConceptAnalysis(),
        design=SceneDesign(title=""),
    )

    assert generated.code.count("line = Text(") == 2
    assert 'line = Text("V = a³"' in generated.code
    assert 'line = Text("3³ = 27"' in generated.code
    assert "V = a³ 与" not in generated.code
