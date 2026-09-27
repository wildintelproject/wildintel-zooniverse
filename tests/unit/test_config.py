def test_settings_file_is_created_with_defaults_and_round_trips(tmp_path):
    from wildintel_zooniverse.core import config

    path = tmp_path / "settings.toml"
    settings = config.load_settings(path)
    assert path.is_file()
    assert settings.TRAPPER.base_url is None

    settings.TRAPPER.base_url = "https://trapper.example.org"
    settings.TRAPPER.user_name = "alice"
    config.save_settings(settings, path)

    assert config.load_settings(path).TRAPPER.user_name == "alice"
