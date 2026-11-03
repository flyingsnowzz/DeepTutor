from deeptutor.agents.math_animator.models import ConceptAnalysis, SceneDesign
from deeptutor.agents.math_animator.structured_scene import structured_manim_code


def test_structured_scene_contains_real_formula_and_avoids_tex():
    generated = structured_manim_code(
        user_input="显示 V = a^3（三个 a 相乘）和 3^3 = 3 * 3 * 3 = 27。",
        analysis=ConceptAnalysis(),
        design=SceneDesign(title="立方体体积"),
    )

    assert "class StructuredMathScene(Scene)" in generated.code
    assert "V = a^3" in generated.code
    assert "3^3 = 3 * 3 * 3 = 27" in generated.code
    assert "MathTex" not in generated.code
    assert "Tex(" not in generated.code
