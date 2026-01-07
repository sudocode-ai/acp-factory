.PHONY: install dev test lint format typecheck clean build publish publish-test

# Install package
install:
	pip install .

# Install with dev dependencies
dev:
	pip install -e ".[dev]"

# Run tests
test:
	pytest

# Run linter
lint:
	ruff check src tests

# Format code
format:
	ruff format src tests
	ruff check --fix src tests

# Run type checker
typecheck:
	mypy src

# Clean build artifacts
clean:
	rm -rf dist build *.egg-info src/*.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete

# Build package
build: clean
	python -m build

# Publish to TestPyPI (for testing)
publish-test: build
	python -m twine upload --repository testpypi dist/*

# Publish to PyPI
publish: build
	python -m twine upload dist/*

# Version bump helpers
version-patch:
	@echo "Update version in pyproject.toml and src/acp_factory/__init__.py"
	@echo "Then run: git tag v<version> && git push --tags"

version-minor:
	@echo "Update version in pyproject.toml and src/acp_factory/__init__.py"
	@echo "Then run: git tag v<version> && git push --tags"

version-major:
	@echo "Update version in pyproject.toml and src/acp_factory/__init__.py"
	@echo "Then run: git tag v<version> && git push --tags"
