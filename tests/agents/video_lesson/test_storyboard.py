from deeptutor.agents.video_lesson.storyboard import storyboard_tsx


def test_storyboard_compiles_complete_lesson():
    code, narration = storyboard_tsx(
        {
            "title": "立方体体积",
            "scenes": [
                {
                    "heading": "公式",
                    "bullets": ["长宽高都是 a", "体积是三维量"],
                    "formula": "V=a³",
                    "narration": "立方体体积等于棱长的三次方。",
                }
            ],
        }
    )

    assert "export const LESSON" in code
    assert "export function Lesson" in code
    assert "V=a³" in code
    assert narration[0].id == "scene-1"
